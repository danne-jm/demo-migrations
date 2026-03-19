import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Base presentation component for buttons.
 * Demonstrates separation of concerns by handling ONLY styling and standard button behavior,
 * completely decoupled from business logic or logging.
 */
export const BaseButton = ({ label, variant = 'primary', style, ...props }) => {
    const baseStyle = {
        padding: '0.5rem 1rem',
        borderRadius: '6px',
        border: 'none',
        cursor: 'pointer',
        fontWeight: 'bold',
        backgroundColor: variant === 'primary' ? '#4CAF50' : '#6c757d',
        color: '#fff',
        margin: '0.5rem',
        transition: 'opacity 0.2s',
        ...style
    };
    return (_jsx("button", { style: baseStyle, ...props, onMouseOver: (e) => (e.currentTarget.style.opacity = '0.8'), onMouseOut: (e) => (e.currentTarget.style.opacity = '1'), children: label }));
};
