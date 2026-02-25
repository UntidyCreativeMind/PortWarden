import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, LogIn, AlertCircle } from 'lucide-react';
import api from '../api';

const Login = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await api.post('/login', { username, password });
            localStorage.setItem('token', res.data.token);
            onLogin(); // Update parent state
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to login');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-icon-wrapper">
                        <Lock size={32} />
                    </div>
                    <h1>PortWarden</h1>
                    <p>Sign in to manage your environment</p>
                </div>

                {error && (
                    <div className="alert alert-error">
                        <AlertCircle size={20} />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleLogin}>
                    <div className="input-group">
                        <label>Username</label>
                        <div className="input-wrapper">
                            <User size={20} className="input-icon" />
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="text-input"
                                placeholder="Enter username"
                                required
                            />
                        </div>
                    </div>

                    <div className="input-group">
                        <label>Password</label>
                        <div className="input-wrapper">
                            <Lock size={20} className="input-icon" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="text-input"
                                placeholder="••••••••"
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary"
                    >
                        {loading ? (
                            <div className="spinner-small" />
                        ) : (
                            <>
                                <LogIn size={20} />
                                Sign In
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;
