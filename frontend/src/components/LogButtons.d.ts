import React from 'react';
import { BaseButtonProps } from './BaseButton';
/**
 * Connected Event component.
 * Extends BaseButton but wires it up to the contextual `trackEvent` function.
 */
export declare const TrackEventButton: React.FC<Omit<BaseButtonProps, 'onClick'>>;
/**
 * Connected Direct Log component.
 * Extends BaseButton but wires it up to the contextual `baseLogging` function.
 */
export declare const DirectLogButton: React.FC<Omit<BaseButtonProps, 'onClick'>>;
