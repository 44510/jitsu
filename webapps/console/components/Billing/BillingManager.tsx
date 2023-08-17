import React, { ReactNode } from "react";
import { useBilling } from "./BillingProvider";
import { useAppConfig, useUser, useWorkspace } from "../../lib/context";
import { assertDefined, assertFalse, assertTrue, requireDefined, rpc } from "juava";
import { BillingSettings } from "../../lib/schema";
import { Alert, Button, Progress, Skeleton, Tooltip } from "antd";
import Link from "next/link";
import { Check, Edit2, Info, XCircle } from "lucide-react";

import styles from "./BillingManager.module.css";
import { useQuery } from "@tanstack/react-query";
import { ErrorCard } from "../GlobalError/GlobalError";
import { useUsage } from "./use-usage";
import { upgradeRequired } from "./copy";
import { JitsuButton } from "../JitsuButton/JitsuButton";

function formatNumber(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export type BillingState = {
  plans: Record<
    string,
    BillingSettings & {
      name: string;
      monthlyPrice: number;
      annualPrice?: number;
      disabled?: boolean;
    }
  >;
};

const ComparisonSection: React.FC<{
  header: ReactNode;
  info?: ReactNode;
  items: (string | { header: string; enabled: boolean })[];
}> = ({ header, items, info }) => {
  return (
    <div className={styles.comparisonSection}>
      <h5 key="credits">
        <span>{header}</span>
        {info && (
          <Tooltip title={info}>
            <Info className="h-3 2-3"></Info>
          </Tooltip>
        )}
      </h5>
      <ul>
        {items.map(item => (
          <li key={typeof item === "string" ? item : item.header}>
            {typeof item === "string" || item.enabled ? <Check className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            <span>{typeof item === "string" ? item : item.header}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const UsageSection: React.FC<{}> = () => {
  const billing = useBilling();
  assertTrue(billing.enabled);
  assertFalse(billing.loading, "Billing must be loaded before using UsageSection component");

  const { isLoading, error, usage } = useUsage();

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 1, width: "100%" }} title={false} />;
  } else if (error) {
    return <ErrorCard error={error} />;
  }

  assertDefined(usage, "Data should be defined");

  const startStr = usage.periodStart.toLocaleString("en-Us", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const endStr = usage.periodEnd.toLocaleString("en-Us", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const usageExceeded = usage.usagePercentage > 1 && billing.settings.planId === "free";
  const usageIsAboutToExceed =
    usage?.projectionByTheEndOfPeriod &&
    usage?.projectionByTheEndOfPeriod > usage?.maxAllowedDestinatonEvents &&
    billing.settings.planId == "free";
  return (
    <div>
      <Progress
        percent={usage.usagePercentage * 100}
        showInfo={false}
        status={usage.usagePercentage > 1 ? "exception" : undefined}
      />
      <div>
        {formatNumber(Math.round(usage?.events))} / {formatNumber(usage.maxAllowedDestinatonEvents)} destination events
        used from <i>{startStr}</i> to <i>{endStr}</i>. The quota will be reset on <i>{endStr}</i>.
      </div>
      {usageExceeded && (
        <div className="mt-8">
          <Alert
            message={<h4 className="text-xl">Upgrade your plan to keep using Jitsu</h4>}
            description={<div className="text-lg">{upgradeRequired}</div>}
            type="error"
            showIcon
          />
        </div>
      )}
      {usageIsAboutToExceed && !usageExceeded && (
        <div className="mt-8">
          <Alert
            message={<h4 className="font-bold">Account quota warning!</h4>}
            showIcon
            type={"warning"}
            description={
              <>
                You are projected to exceed your monthly events destination limit by{" "}
                <b>{formatNumber((usage?.projectionByTheEndOfPeriod || 0) - usage?.maxAllowedDestinatonEvents)}</b>{" "}
                events. Please upgrade your plan to avoid service disruption.
              </>
            }
          />
        </div>
      )}
      {usage.usagePercentage > 1 && billing.settings.planId !== "free" && (
        <div className="mt-8">
          <Alert
            message={<h4 className="font-bold">Overage fee warning</h4>}
            description={
              <div>
                You have exceeded your monthly events destination limit by{" "}
                <b>{formatNumber(usage.events - usage.maxAllowedDestinatonEvents)}</b>. The overage fee of at least $
                <b>
                  {(
                    ((usage.events - usage.maxAllowedDestinatonEvents) / 100_000) *
                    (billing.settings?.overagePricePer100k || 0)
                  ).toLocaleString("en-us", { maximumFractionDigits: 2 })}
                </b>{" "}
                will be added to your next invoice.{" "}
                {usage.projectionByTheEndOfPeriod && (
                  <>
                    The projected overage fee by end of the month is{" "}
                    <b>
                      $
                      {(
                        ((usage?.projectionByTheEndOfPeriod - usage.maxAllowedDestinatonEvents) / 100_000) *
                        (billing.settings?.overagePricePer100k || 0)
                      ).toLocaleString("en-us", { maximumFractionDigits: 2 })}
                    </b>{" "}
                  </>
                )}
              </div>
            }
            type="info"
            showIcon
          />
        </div>
      )}
    </div>
  );
};

const CurrentSubscription: React.FC<{}> = () => {
  const billing = useBilling();
  assertTrue(billing.enabled, "Billing is not enabled");
  assertFalse(billing.loading, "Billing must be loaded before using CurrentSubscription component");

  const workspace = useWorkspace();
  return (
    <div className="border border-textDisabled rounded-lg px-6 py-12">
      <div className="flex flex-row justify-between">
        <div className="">
          <div className="text-2xl text-textDark font-bold">
            {(billing.settings.planName || billing.settings.planId).toUpperCase()}
          </div>
          <div className="text-primary">
            {billing.settings.planId !== "free" && (
              <Link
                prefetch={false}
                className="flex items-center"
                href={`/api/${workspace.id}/ee/billing/manage?returnUrl=${encodeURIComponent(window.location.href)}`}
              >
                <span>Manage subscription / download invoices</span>
                <Edit2 className="ml-1 h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
        <div>
          {billing.settings.planId !== "free" && (
            <div className="flex flex items-center">
              {billing.settings?.renewAfterExpiration ? (
                <div className="text-textLight">Renews at</div>
              ) : (
                <div className="text-error">Cancels at</div>
              )}
              <div className="ml-2 rounded-3xl bg-textDark text-backgroundLight px-3 py-1 text-sm">
                {new Date(billing.settings?.expiresAt as string).toLocaleString("en-Us", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      <h3 className="text-lg text-textLight my-6">Usage</h3>
      <UsageSection />
    </div>
  );
};

const AvailablePlans: React.FC<{}> = () => {
  const appConfig = useAppConfig();
  const billing = useBilling();
  assertTrue(billing.enabled, "Billing is not enabled");
  assertFalse(billing.loading, "Billing must be loaded before using CurrentSubscription component");

  const workspace = useWorkspace();
  const user = useUser();

  const { isLoading, error, data } = useQuery(
    ["availablePlans", workspace.id],
    async () => {
      const plans = await rpc(`/api/${workspace.id}/ee/billing/plans`);
      assertDefined(billing.settings.planId, `planId is not defined in ${JSON.stringify(billing.settings)}`);

      return {
        plans: {
          free: { ...BillingSettings.parse({}), monthlyPrice: 0, annualPrice: 0 },
          ...plans.products
            .filter(p => !p.data.disabled)
            .reduce(
              (acc, p) => ({
                ...acc,
                [requireDefined(p.id, `No id in ${JSON.stringify(p)}`)]: {
                  ...BillingSettings.parse(requireDefined(p.data, `No data in ${JSON.stringify(p)}`)),
                  name: requireDefined(p.name, `No name in ${JSON.stringify(p)}`),
                  monthlyPrice: requireDefined(p.monthlyPrice, `No monthlyPrice in ${JSON.stringify(p)}`),
                  annualPrice: p.annualPrice,
                },
              }),
              {}
            ),
          enterprise: {
            ...BillingSettings.parse({
              planId: "enterprise",
              destinationEvensPerMonth: -1,
              overagePricePer100k: undefined,
              canShowProvisionDbCredentials: true,
            }),
            monthlyPrice: -1,
            annualPrice: -1,
            name: "enterprise",
          },
        },
      } as BillingState;
    },
    { cacheTime: 0, retry: false }
  );
  if (isLoading) {
    return <Skeleton active />;
  } else if (error) {
    return <ErrorCard error={error} title="Failed to load available plans" />;
  }
  assertDefined(data, "Data is not defined");

  return (
    <div className="flex flex-row flex-nowrap justify-center space-x-6">
      {Object.entries(data.plans).map(([planId, plan]) => (
        <div key={planId} className="border py-4 px-6 border-backgroundDark rounded-xl w-96">
          <h3 className="text-textDark font-bold font-xl uppercase">{plan.name || "Free"}</h3>
          <div className="my-6 ">
            {plan.monthlyPrice >= 0 ? (
              <>
                <span className="text-2xl">${plan.monthlyPrice}</span>
                <span className="text-textLight"> / month</span>
              </>
            ) : (
              <span className="text-2xl">Custom pricing</span>
            )}
          </div>
          <ComparisonSection
            key="destination-events"
            header="Destination events included"
            info="Destination events are events sent to your destinations."
            items={[
              plan.destinationEvensPerMonth > 0
                ? `${formatNumber(plan.destinationEvensPerMonth)} per month`
                : `Unlimited`,
            ]}
          />
          <ComparisonSection
            key="fee"
            header="More events"
            items={[
              plan.overagePricePer100k
                ? { enabled: true, header: `$${plan.overagePricePer100k} per 100,000 events ` }
                : { enabled: false, header: "n/a" },
            ]}
          />
          <ComparisonSection
            key="clickhouse"
            header="Clickhouse"
            items={[
              { enabled: true, header: "UI Access" },
              { enabled: plan.canShowProvisionDbCredentials, header: "API Access" },
            ]}
          />
          <div className="my-6">
            {planId === billing.settings.planId ? (
              <JitsuButton icon={<Check />} className="w-full" size="large" type="ghost" disabled={true}>
                Current plan
              </JitsuButton>
            ) : planId === "free" ? (
              <Button
                href={`/api/${workspace.id}/ee/billing/manage?returnUrl=${encodeURIComponent(window.location.href)}`}
                className="w-full"
                size="large"
              >
                Downgrade
              </Button>
            ) : plan.monthlyPrice >= 0 ? (
              <Button
                href={
                  billing.settings.planId === "free"
                    ? `/api/${workspace.id}/ee/billing/upgrade?planId=${planId}&returnUrl=${encodeURIComponent(
                        window.location.href
                      )}&email=${encodeURIComponent(user.email)}`
                    : `/api/${workspace.id}/ee/billing/manage?returnUrl=${encodeURIComponent(window.location.href)}`
                }
                className="w-full"
                size="large"
                type="primary"
              >
                Upgrade
              </Button>
            ) : (
              <Button
                className="w-full"
                size="large"
                href={`${appConfig.websiteUrl || "https://jitsu.com"}/contact?utm_source=app`}
              >
                Contact us
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const BillingManager0: React.FC<{}> = () => {
  const appConfig = useAppConfig();
  return (
    <div>
      <CurrentSubscription />
      <h3 className="my-12 text-2xl text-center">Available Plans</h3>
      <AvailablePlans />
      <p className="text-center text-textLight text-sm mt-12">
        Need more information? Learn more about each plan by checking out our{" "}
        <a className="text-primary" href={`${appConfig.websiteUrl || "https://jitsu.com"}/pricing?utm_source=app`}>
          pricing page
        </a>
      </p>
    </div>
  );
};

export const BillingManager = React.memo(BillingManager0);
