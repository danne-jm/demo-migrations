import React from 'react';
import { BaseButton, BaseButtonProps } from './BaseButton';
import { useDeepLogger } from '../hooks/useDeepLogger';

/**
 * Connected Event component.
 * Extends BaseButton but wires it up to the contextual `trackEvent` function.
 */
export const TrackEventButton: React.FC<Omit<BaseButtonProps, 'onClick'>> = (props) => {
  const { trackEvent } = useDeepLogger();
  
  return (
    <BaseButton 
      variant="primary" 
      onClick={() => trackEvent('User clicked Track Event Button!')} 
      {...props} 
    />
  );
};

/**
 * Connected Direct Log component.
 * Extends BaseButton but wires it up to the contextual `baseLogging` function.
 */
export const DirectLogButton: React.FC<Omit<BaseButtonProps, 'onClick'>> = (props) => {
  const { baseLogging } = useDeepLogger();
  
  return (
    <BaseButton 
      variant="secondary" 
      onClick={() => baseLogging('User clicked Direct Obscure Log Button!')} 
      {...props} 
    />
  );
};
