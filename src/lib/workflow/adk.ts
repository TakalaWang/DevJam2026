import {
  Gemini,
  GOOGLE_SEARCH,
  InMemorySessionService,
  isFinalResponse,
  LlmAgent,
  Runner,
  stringifyContent,
} from "@google/adk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AgentInputSchema,
  AgentNameSchema,
  AdkSessionStateSchema,
  AdkOutputSchemas,
  ActivitySearchResearchOutputSchema,
  GoogleSearchGroundingMetadataSchema,
  SearchEvidenceSchema,
  type Evidence,
  type AgentInput,
  type AgentName,
} from "../../contracts";
import { createPlaceTool, createRouteTool } from "./tools";

const modelName = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

const instructions: Record<AgentName, string> = {
  travel_boundary:
    "你是旅遊邊界 Agent。從輸入對話整理航班與住宿候選。需要使用者決策時使用 ask_user；只能輸出符合 schema 的 JSON。",
  daily_frame:
    "你是每日框架 Agent。根據旅遊邊界與使用者習慣建立每日 slots，分開 hard 與 soft constraint。只能輸出符合 schema 的 JSON。",
  activity_discovery:
    "你是景點探索 Agent。調查使用者偏好與必去項目，推薦景點或餐廳。推薦可標記 suggested，不能假裝成 confirmed。只能輸出符合 schema 的 JSON。",
  schedule:
    "你是排程 Agent。一次只提出一個活動的新增、移動或移除，保留 hard constraints，使用交通與地點工具取得證據。只能輸出符合 schema 的 JSON。",
  item_review:
    "你是單項 review Agent。檢查單一活動的時間、交通、營業時間與 buffer，發現問題就 rejected 或 unverified。只能輸出符合 schema 的 JSON。",
  daily_review:
    "你是整日 review Agent。檢查完整一天的節奏、睡眠、用餐、休息、交通、營業時間與偏好。只能輸出符合 schema 的 JSON。",
};

function toolsFor(agent: AgentName) {
  if (agent === "travel_boundary") return [GOOGLE_SEARCH];
  if (agent === "schedule" || agent === "item_review" || agent === "daily_review") {
    return [createRouteTool(), createPlaceTool()];
  }
  return [];
}

function createActivitySearchAgent(model: Gemini): LlmAgent {
  return new LlmAgent({
    name: "activity_discovery_research",
    model,
    instruction:
      "你是景點研究 Agent。使用 Google Search 找到官方或可靠來源，僅輸出符合 schema 的 typed research JSON。",
    outputSchema: ActivitySearchResearchOutputSchema,
    tools: [GOOGLE_SEARCH],
    generateContentConfig: { toolConfig: { includeServerSideToolInvocations: true } },
    includeContents: "none",
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
  });
}

function createAgent(agent: AgentName, model: Gemini): LlmAgent {
  return new LlmAgent({
    name: agent,
    model,
    instruction: instructions[agent],
    inputSchema: AgentInputSchema,
    outputSchema: AdkOutputSchemas[agent],
    tools: toolsFor(agent),
    ...(agent === "travel_boundary"
      ? { generateContentConfig: { toolConfig: { includeServerSideToolInvocations: true } } }
      : {}),
    includeContents: "none",
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
  });
}

export class AgentOutputInvalidError extends Error {
  readonly code = "agent_output_invalid" as const;

  constructor(message: string) {
    super(message);
  }
}

export class AgentUnavailableError extends Error {
  readonly code = "agent_unavailable" as const;

  constructor(message: string) {
    super(message);
  }
}

export interface AgentRuntime {
  run<T extends AgentOutputWithEvidence>(
    agent: AgentName,
    input: AgentInput,
    schema: z.ZodType<T>,
  ): Promise<T>;
}

type AgentOutputWithEvidence = { message: string; evidence: Evidence[]; evidenceIds: string[] };

export class AdkAgentRuntime implements AgentRuntime {
  private readonly runners: ReadonlyMap<AgentName, Runner>;
  private readonly activityResearchRunner: Runner;

  constructor(apiKey: string) {
    const model = new Gemini({ model: modelName, apiKey });
    const runners = AgentNameSchema.options.map((agent) => {
      const rootAgent = createAgent(agent, model);
      return [
        agent,
        new Runner({
          appName: `routecraft_${agent}`,
          agent: rootAgent,
          sessionService: new InMemorySessionService(),
        }),
      ] as const;
    });
    this.runners = new Map(runners);
    this.activityResearchRunner = new Runner({
      appName: "routecraft_activity_discovery_research",
      agent: createActivitySearchAgent(model),
      sessionService: new InMemorySessionService(),
    });
  }

  async run<T extends AgentOutputWithEvidence>(
    agent: AgentName,
    input: AgentInput,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const parsedInput = AgentInputSchema.parse(input);
    const runner = this.runners.get(agent);
    if (!runner) throw new Error(`找不到 Agent: ${agent}`);

    let executionInput = parsedInput;
    let researchEvidence: Evidence[] = [];
    if (agent === "activity_discovery") {
      const research = await this.runRunner(
        this.activityResearchRunner,
        parsedInput,
        ActivitySearchResearchOutputSchema,
      );
      researchEvidence = research.evidence;
      executionInput = AgentInputSchema.parse({
        ...parsedInput,
        userMessage: `${parsedInput.userMessage}\n\n前置 typed research：${JSON.stringify(research)}`,
      });
    }

    const output = await this.runRunner(runner, executionInput, schema);
    if (!researchEvidence.length) return output;
    const evidence = [...researchEvidence, ...output.evidence].filter(
      (item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index,
    );
    return schema.parse({
      ...output,
      evidence,
      evidenceIds: [
        ...new Set([...researchEvidence.map((item) => item.id), ...output.evidenceIds]),
      ],
    });
  }

  private async runRunner<T extends AgentOutputWithEvidence>(
    runner: Runner,
    input: AgentInput,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const sessionId = `${input.tripId}_${runner.appName}`;
    let lastError = "Agent 沒有回傳有效 schema";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let outputText = "";
      const groundingUrls: string[] = [];
      const groundingQueries: string[] = [];
      const groundingTitles: string[] = [];
      try {
        const stateDelta = AdkSessionStateSchema.parse({ workflow_input: input });
        await runner.sessionService.getOrCreateSession({
          appName: runner.appName,
          userId: input.tripId,
          sessionId,
          state: stateDelta,
        });
        const events = runner.runAsync({
          userId: input.tripId,
          sessionId,
          newMessage: { role: "user", parts: [{ text: JSON.stringify(input) }] },
          stateDelta,
        });
        for await (const event of events) {
          if (event.errorCode)
            throw new Error(`ADK ${event.errorCode}: ${event.errorMessage ?? ""}`);
          if (event.groundingMetadata) {
            const grounding = GoogleSearchGroundingMetadataSchema.parse(event.groundingMetadata);
            groundingQueries.push(...grounding.webSearchQueries);
            for (const chunk of grounding.groundingChunks) {
              if (chunk.web) {
                groundingUrls.push(chunk.web.uri);
                if (chunk.web.title) groundingTitles.push(chunk.web.title);
              }
            }
          }
          if (isFinalResponse(event)) outputText = stringifyContent(event);
        }
      } catch (error) {
        throw new AgentUnavailableError(
          error instanceof Error ? error.message : "Agent 服務無法使用",
        );
      }

      try {
        const parsed = schema.parse(JSON.parse(outputText));
        if (!groundingUrls.length) return parsed;
        const groundingEvidence = SearchEvidenceSchema.parse({
          id: `search-${randomUUID()}`,
          kind: "search",
          source: "Google Search grounding",
          fetchedAt: new Date().toISOString(),
          summary: `Google Search: ${groundingTitles.slice(0, 3).join("、") || parsed.message}`,
          query: groundingQueries[0] ?? parsed.message,
          sourceUrls: [...new Set(groundingUrls)],
        });
        return schema.parse({
          ...parsed,
          evidence: [...parsed.evidence, groundingEvidence],
          evidenceIds: [...new Set([...parsed.evidenceIds, groundingEvidence.id])],
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    throw new AgentOutputInvalidError(lastError);
  }
}

export function createAgentRuntime(): AgentRuntime {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AgentUnavailableError("尚未設定 GEMINI_API_KEY");
  return new AdkAgentRuntime(apiKey);
}

export function outputSchemaFor(agent: AgentName) {
  return AdkOutputSchemas[agent];
}
