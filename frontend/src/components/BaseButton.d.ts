import React from 'react';
export interface BaseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    label: string;
    variant?: 'primary' | 'secondary';
}
/**
 * Base presentation component for buttons.
 * Demonstrates separation of concerns by handling ONLY styling and standard button behavior,
 * completely decoupled from business logic or logging.
 */
export declare const BaseButton: React.FC<BaseButtonProps>;
