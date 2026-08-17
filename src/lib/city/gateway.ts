import {
  CityFeedQuerySchema,
  CityFeedSnapshotSchema,
  type CityFeedQuery,
  type CityFeedSnapshot,
} from "../../contracts";
import { CwaClient } from "./cwa";
import { NcdrClient } from "./ncdr";
import { TaipeiMetroClient } from "./metro";
import { TdxClient } from "./tdx";
import { now } from "./common";

export type CityDataGatewayOptions = {
  tdx?: TdxClient;
  cwa?: CwaClient;
  ncdr?: NcdrClient;
  metro?: TaipeiMetroClient;
};

export class CityDataGateway {
  private readonly tdx: TdxClient;
  private readonly cwa: CwaClient;
  private readonly ncdr: NcdrClient;
  private readonly metro: TaipeiMetroClient;

  constructor(options: CityDataGatewayOptions = {}) {
    this.tdx = options.tdx ?? new TdxClient();
    this.cwa = options.cwa ?? new CwaClient();
    this.ncdr = options.ncdr ?? new NcdrClient();
    this.metro = options.metro ?? new TaipeiMetroClient();
  }

  async refresh(rawQuery: CityFeedQuery): Promise<CityFeedSnapshot> {
    const query = CityFeedQuerySchema.parse(rawQuery);
    const feeds = await Promise.all([
      this.tdx.fetchCity(query.city),
      this.cwa.fetchCity(query.city),
      this.ncdr.fetchCity(query.city),
      this.metro.fetchCity(query.city),
    ]);
    return CityFeedSnapshotSchema.parse({
      city: query.city,
      checkedAt: now(),
      feeds,
      observations: feeds.flatMap((feed) => feed.observations),
      signals: feeds.flatMap((feed) => feed.signals),
    });
  }
}
