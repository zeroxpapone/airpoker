interface Props {
  name: string;
  onChange: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export default function LoginForm({ name, onChange, onSubmit }: Props) {
  return (
    <form onSubmit={onSubmit} className="form-field-group" id="form-login-legacy">
      <div className="form-field-group" id="field-login-legacy-name">
        <label className="form-label-title" htmlFor="input-login-legacy-name">
          Nome giocatore
        </label>
        <input
          id="input-login-legacy-name"
          type="text"
          value={name}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Es. Pippo, Nico, Mira..."
        />
      </div>
      <button
        id="btn-login-legacy-submit"
        type="submit"
        className="poker-btn-primary"
        style={{ width: "100%", padding: "0.55rem 0.75rem", borderRadius: "0.5rem" }}
      >
        Entra
      </button>
    </form>
  );
}
