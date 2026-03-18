type StatusCardProps = {
  title: string;
  value: string;
  subtitle?: string;
};

export const StatusCard = ({ title, value, subtitle }: StatusCardProps) => {
  return (
    <section className="card">
      <p className="card-title">{title}</p>
      <h3 className="card-value">{value}</h3>
      {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
    </section>
  );
};
