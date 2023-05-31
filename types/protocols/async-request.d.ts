import { ISO8601Date } from "./iso8601";

export type IngestType = "s2s" | "browser";

export type IngestMessage = {
  ingestType: IngestType;
  messageCreated: ISO8601Date;
  writeKey: string;
  messageId: string;
  connectionId: string;
  type: string;
  origin: {
    baseUrl: string;
    slug?: string;
    domain?: string;
  };
  httpHeaders: Record<string, string>;
  httpPayload: any;
};
