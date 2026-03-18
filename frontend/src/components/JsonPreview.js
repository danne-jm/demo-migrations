import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const JsonPreview = ({ title, payload }) => {
    return (_jsxs("section", { className: "panel", children: [_jsx("div", { className: "panel-header", children: _jsx("h4", { children: title }) }), _jsx("pre", { className: "json-preview", children: JSON.stringify(payload, null, 2) })] }));
};
