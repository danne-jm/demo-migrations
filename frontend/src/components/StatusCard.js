import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const StatusCard = ({ title, value, subtitle }) => {
    return (_jsxs("section", { className: "card", children: [_jsx("p", { className: "card-title", children: title }), _jsx("h3", { className: "card-value", children: value }), subtitle ? _jsx("p", { className: "card-subtitle", children: subtitle }) : null] }));
};
