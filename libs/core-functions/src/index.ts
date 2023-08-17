import {
  BuiltinDestinationFunctionName,
  BuiltinFunctionName,
  BuiltinTransformationFunctionName,
  JitsuFunction,
} from "@jitsu/protocols/functions";
import BulkerDestination from "./functions/bulker-destination";
import MixpanelDestination from "./functions/mixpanel-destination";
import Ga4Destination from "./functions/ga4-destination";
import WebhookDestination from "./functions/webhook-destination";
import PosthogDestination from "./functions/posthog-destination";
import UserRecognitionFunction from "./functions/user-recognition";
import MongodbDestination from "./functions/mongodb-destination";
import JuneDestination from "./functions/june-destination";
import SegmentDestination from "./functions/segment-destination";

const builtinDestinations: Record<BuiltinDestinationFunctionName, JitsuFunction> = {
  "builtin.destination.bulker": BulkerDestination as JitsuFunction,
  "builtin.destination.mixpanel": MixpanelDestination as JitsuFunction,
  "builtin.destination.segment-proxy": SegmentDestination as JitsuFunction,
  "builtin.destination.june": JuneDestination as JitsuFunction,
  "builtin.destination.ga4": Ga4Destination as JitsuFunction,
  "builtin.destination.webhook": WebhookDestination as JitsuFunction,
  "builtin.destination.posthog": PosthogDestination as JitsuFunction,
  "builtin.destination.mongodb": MongodbDestination as JitsuFunction,
  "builtin.destination.devnull": () => null,
} as const;

const builtinTransformations: Record<BuiltinTransformationFunctionName, JitsuFunction> = {
  "builtin.transformation.user-recognition": UserRecognitionFunction as JitsuFunction,
} as const;

const builtinFunctions: Record<BuiltinFunctionName, JitsuFunction> = {
  ...builtinDestinations,
  ...builtinTransformations,
} as const;

export function getBuiltinFunction(id: string): JitsuFunction | undefined {
  const fixedId = id.indexOf("builtin.") === 0 ? id : `builtin.${id}`;
  return builtinFunctions[fixedId];
}

export * as bulkerDestination from "./functions/bulker-destination";
export { UDFWrapper } from "./functions/udf_vm2";
export { createFullContext } from "./context";
export * as mixpanelDestination from "./functions/mixpanel-destination";
export * as ga4Destination from "./functions/ga4-destination";
export * as webhookDestination from "./functions/webhook-destination";
export * as posthogDestination from "./functions/posthog-destination";
export * as mongodbDestination from "./functions/mongodb-destination";
export { mongodb, mongoAnonymousEventsStore } from "./functions/lib/mongodb";
