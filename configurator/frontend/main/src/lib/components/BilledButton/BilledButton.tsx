import { Button, ButtonProps, Tooltip } from "antd"
import { useServices } from "hooks/useServices"
import { PricingPlanId } from "lib/services/billing"
import { useMemo } from "react"

type Props = {
  /** Text to display if the button is blocked */
  tooltipTitle?: string
} & BlockingSchema &
  ButtonProps

/**
 * Button that is blocked depending on the current subscription.
 *
 * To decide on blocking it uses on of the following:
 * - Explicit 'isBlocked' boolean
 * - Pricing plans IDs blacklist
 * - Pricing plans IDs whitelist
 *
 * Note: it is always unblocked for the 'opensource' plan
 */
export const BilledButton: React.FC<Props> = ({
  isBlocked,
  plansBlacklist,
  plansWhitelist,
  tooltipTitle,
  children,
  ...buttonProps
}) => {
  const currentPlan = useServices().currentSubscription.currentPlan
  const isButtonBlocked = useMemo<boolean>(() => {
    if (currentPlan.id === "opensource") return false
    return isBlocked ?? plansBlacklist?.includes(currentPlan.id) ?? !plansWhitelist?.includes(currentPlan.id) ?? false
  }, [isBlocked, currentPlan])

  const Wrapper = isButtonBlocked
    ? ({ children }) => (
        <Tooltip title={tooltipTitle ?? "This feature is not available in your subscription plan"}>{children}</Tooltip>
      )
    : ({ children }) => <>{children}</>

  return (
    <Wrapper>
      <Button disabled={isButtonBlocked} {...buttonProps}>
        {children}
      </Button>
    </Wrapper>
  )
}

/**
 * One of the following:
 * - explicit boolean
 * - plans blacklist
 * - plans whitelist
 **/
type BlockingSchema = IsExplicitlyBlocked | PlansBlacklist | PlansWhitelist

type IsExplicitlyBlocked = {
  /** Whether to block the button explicitly */
  isBlocked: boolean
  plansBlacklist?: never
  plansWhitelist?: never
}

type PlansBlacklist = {
  isBlocked?: never
  /** Plans IDs to block the button for */
  plansBlacklist: PricingPlanId[] | Readonly<PricingPlanId[]>
  plansWhitelist?: never
}

type PlansWhitelist = {
  isBlocked?: never
  plansBlacklist?: never
  /** Plans IDs to unblock the button for */
  plansWhitelist: PricingPlanId[] | Readonly<PricingPlanId[]>
}
