import { useBilling, UseBillingResult } from "./BillingProvider";
import { assertDefined, assertFalse, assertTrue, getLog } from "juava";
import { useUsage } from "./use-usage";
import { Modal } from "antd";
import { upgradeRequired } from "./copy";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { WJitsuButton } from "../JitsuButton/JitsuButton";
import { useWorkspace, WorkspaceContext } from "../../lib/context";

const log = getLog("billing");

function LoadAndBlockIfNeed() {
  const billing = useBilling();

  assertTrue(billing.enabled);
  assertFalse(billing.loading);

  const { isLoading, error, usage } = useUsage();
  if (isLoading) {
    return <></>;
  } else if (error) {
    log.atWarn().withCause(error).log("Failed to load usage");
    return <></>;
  }
  assertDefined(usage);
  if (usage.usagePercentage > 1) {
    return (
      <Modal
        style={{ minWidth: 1000 }}
        open={true}
        title={
          <div className="flex items-center space-x-4">
            <AlertTriangle className="w-8 h-8 text-error" />
            <h2 className="text-4xl">Upgrade required</h2>
          </div>
        }
        closable={false}
        footer={
          <div className="w-full">
            <WJitsuButton
              href={`/settings/billing`}
              className="w-full"
              size="large"
              type="primary"
              icon={<ArrowRight className="-rotate-45 w-4 h-4" />}
            >
              Manage Billing {"&"} Plan
            </WJitsuButton>
          </div>
        }
      >
        <div className="text-lg my-12">{upgradeRequired}</div>
      </Modal>
    );
  } else {
    return <></>;
  }
}

export function usageExceeded(billing: UseBillingResult, workspace: WorkspaceContext) {
  return (
    !billing.enabled ||
    billing.loading ||
    billing.settings.planId !== "free" ||
    workspace.featuresEnabled.includes("noblock")
  );
}

export const BillingBlockingDialog = () => {
  const billing = useBilling();
  const workspace = useWorkspace();
  if (usageExceeded(billing, workspace)) {
    return <></>;
  } else {
    return <LoadAndBlockIfNeed />;
  }
};
