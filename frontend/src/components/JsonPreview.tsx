type JsonPreviewProps = {
  title: string;
  payload: unknown;
};

export const JsonPreview = ({ title, payload }: JsonPreviewProps) => {
  return (
    <section className="panel">
      <div className="panel-header">
        <h4>{title}</h4>
      </div>
      <pre className="json-preview">{JSON.stringify(payload, null, 2)}</pre>
    </section>
  );
};
