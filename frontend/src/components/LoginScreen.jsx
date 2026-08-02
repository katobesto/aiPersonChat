import { useState } from 'react';
import { loginUser } from '../api';

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      await loginUser(username.trim(), password);
      onLogin();
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>AI Chat</h1>
        <p className="login-subtitle">Inicia sesión para continuar</p>

        {error && (
          <div className="login-error" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px' }}>
            <i className="fas fa-triangle-exclamation"></i> {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button className="btn-login" type="submit" disabled={loading || !username.trim() || !password}>
            {loading ? (
              <>
                <i className="fas fa-spinner fa-spin"></i> Entrando...
              </>
            ) : (
              <>
                <i className="fas fa-right-to-bracket"></i> Iniciar sesión
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
