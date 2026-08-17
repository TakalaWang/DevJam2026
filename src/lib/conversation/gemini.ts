import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";
import {
  ConversationAgentInputSchema,
  ConversationAgentModelOutputSchema,
  ConversationAgentOutputSchema,
  ConversationAgentResultSchema,
  ItineraryCommandSchema,
  NotificationAgentOutputSchema,
  type ConversationAgentResult,
  type ConversationAgentModelOutput,
  type DayItinerarySnapshot,
  type ItineraryCommand,
  type NotificationAgentInput,
  type NotificationAgentOutput,
} from "../../contracts";
import {
  ConversationAgentOutputInvalidError,
  ConversationAgentUnavailableError,
  type ItineraryAgent,
  notificationInput,
  UnavailableItineraryAgent,
} from "./agent";

const modelName = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

const conversationInstruction =
  '你是 Routecraft 的一天行程對話 Agent。只能輸出符合 response schema 的 JSON。command 必須使用 action 欄位，不能使用 type；需要補充資料時使用 { action: "ask_clarification", question }。理解使用者想去的地點、固定活動、出發與回家位置、日期與交通偏好，將新增或修改轉成 typed command。只有當從出門到回家、所有交通段與固定活動都已經合理時，planningStatus 才能是 ready，並在 message 告訴使用者看起來行程沒問題。資料不足時使用 ask_clarification 與 needs_details。不要自行計算路線，不要捏造即時城市狀態。';

const notificationInstruction =
  "你是 Routecraft 的行程更新通知 Agent。只能輸出符合 response schema 的 JSON。用繁體中文清楚說明哪一段行程受城市事件影響，以及系統已做的路線更新。不要修改行程資料。";

const GeminiInteractionResponseSchema = z.object({
  id: z.string().min(1),
  output_text: z.string().min(1),
});

const conversationResponseSchema = z.toJSONSchema(ConversationAgentModelOutputSchema);
const notificationResponseSchema = z.toJSONSchema(NotificationAgentOutputSchema);
const GeminiConversationInputSchema = ConversationAgentInputSchema.extend({
  validationHint: z.string().min(1).optional(),
});

function normalizeCommand(command: ConversationAgentModelOutput["command"]): ItineraryCommand {
  switch (command.action) {
    case "propose_day":
      return ItineraryCommandSchema.parse({
        action: command.action,
        date: command.date,
        startAt: command.startAt,
        endAt: command.endAt,
        origin: command.origin,
        returnHome: command.returnHome,
        profiles: command.profiles,
        stops: command.stops,
      });
    case "add_stop":
      return ItineraryCommandSchema.parse({
        action: command.action,
        stop: command.stop,
        ...(command.afterStopId === null ? {} : { afterStopId: command.afterStopId }),
      });
    case "remove_stop":
      return ItineraryCommandSchema.parse({ action: command.action, stopId: command.stopId });
    case "move_stop":
      return ItineraryCommandSchema.parse({
        action: command.action,
        stopId: command.stopId,
        ...(command.afterStopId === null ? {} : { afterStopId: command.afterStopId }),
        ...(command.timeWindow === null ? {} : { timeWindow: command.timeWindow }),
      });
    case "start_navigation":
    case "complete_navigation":
      return ItineraryCommandSchema.parse({ action: command.action });
    case "ack_notification":
      return ItineraryCommandSchema.parse({
        action: command.action,
        notificationId: command.notificationId,
      });
    case "ask_clarification":
      return ItineraryCommandSchema.parse({ action: command.action, question: command.question });
  }
}

type StructuredInteraction<T> = {
  output: T;
  interactionId: string;
};

export class GeminiItineraryAgent implements ItineraryAgent {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async interpret(
    itinerary: DayItinerarySnapshot,
    userMessage: string,
    previousInteractionId?: string,
  ): Promise<ConversationAgentResult> {
    const input = ConversationAgentInputSchema.parse({ itinerary, userMessage });
    let lastError = "Gemini 沒有回傳有效 schema";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const request = GeminiConversationInputSchema.parse({
          ...input,
          ...(attempt > 0 ? { validationHint: lastError } : {}),
        });
        const result = await this.createInteraction(
          JSON.stringify(request),
          ConversationAgentModelOutputSchema,
          conversationResponseSchema,
          previousInteractionId,
          conversationInstruction,
        );
        const output = ConversationAgentOutputSchema.parse({
          message: result.output.message,
          planningStatus: result.output.planningStatus,
          command: normalizeCommand(result.output.command),
        });
        return ConversationAgentResultSchema.parse({
          output,
          interactionId: result.interactionId,
        });
      } catch (error) {
        if (error instanceof ConversationAgentUnavailableError) throw error;
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    throw new ConversationAgentOutputInvalidError(lastError);
  }

  async draftNotification(input: NotificationAgentInput): Promise<NotificationAgentOutput> {
    const parsedInput = notificationInput(input);
    let lastError = "Gemini 沒有回傳有效 schema";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.createInteraction(
          JSON.stringify(parsedInput),
          NotificationAgentOutputSchema,
          notificationResponseSchema,
          undefined,
          notificationInstruction,
        );
        return NotificationAgentOutputSchema.parse(result.output);
      } catch (error) {
        if (error instanceof ConversationAgentUnavailableError) throw error;
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    throw new ConversationAgentOutputInvalidError(lastError);
  }

  private async createInteraction<T>(
    input: string,
    schema: z.ZodType<T>,
    jsonSchema: JSONSchema.BaseSchema,
    previousInteractionId: string | undefined,
    systemInstruction: string,
  ): Promise<StructuredInteraction<T>> {
    let response: Awaited<ReturnType<GoogleGenAI["interactions"]["create"]>>;
    try {
      response = await this.client.interactions.create({
        model: modelName,
        input,
        system_instruction: systemInstruction,
        previous_interaction_id: previousInteractionId,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: jsonSchema,
        },
      });
    } catch (error) {
      throw new ConversationAgentUnavailableError(
        error instanceof Error ? error.message : "Gemini Interactions API 無法使用",
      );
    }
    const parsedResponse = GeminiInteractionResponseSchema.parse(response);
    return {
      output: schema.parse(JSON.parse(parsedResponse.output_text)),
      interactionId: parsedResponse.id,
    };
  }
}

export function createItineraryAgent(): ItineraryAgent {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return new UnavailableItineraryAgent("尚未設定 GEMINI_API_KEY");
  return new GeminiItineraryAgent(apiKey);
}
