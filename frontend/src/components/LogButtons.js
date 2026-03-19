import { jsx as _jsx } from "react/jsx-runtime";
import { BaseButton } from './BaseButton';
import { useDeepLogger } from '../hooks/useDeepLogger';
/**
 * Connected Event component.
 * Extends BaseButton but wires it up to the contextual `trackEvent` function.
 */
export const TrackEventButton = (props) => {
    const { trackEvent } = useDeepLogger();
    return (_jsx(BaseButton, { variant: "primary", onClick: () => trackEvent('User clicked Track Event Button!'), ...props }));
};
/**
 * Connected Direct Log component.
 * Extends BaseButton but wires it up to the contextual `baseLogging` function.
 */
export const DirectLogButton = (props) => {
    const { baseLogging } = useDeepLogger();
    return (_jsx(BaseButton, { variant: "secondary", onClick: () => baseLogging('User clicked Direct Obscure Log Button!'), ...props }));
};
