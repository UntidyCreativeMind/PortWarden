import React, { useState, useEffect } from 'react';
import { ArrowLeft, Save, AlertCircle, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const Settings = () => {
    const [settings, setSettings] = useState({
        host_ip: '',
        ssh_username: '',
        ssh_key_path: '',
        portainer_url: '',
        portainer_token: ''
    });

    const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirm: '' });

    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState('');
    const [error, setError] = useState('');

    const navigate = useNavigate();

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await api.get('/settings');
                const data = {};
                for (const k in res.data) data[k] = res.data[k] || '';
                setSettings(prev => ({ ...prev, ...data }));
            } catch (err) {
                console.error(err);
            }
        };
        fetchSettings();
    }, []);

    const handleChange = (e) => {
        setSettings(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setLoading(true);
        setSuccess('');
        setError('');

        try {
            await api.post('/settings', settings);
            setSuccess('Settings saved successfully!');
        } catch (err) {
            setError('Failed to save settings.');
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (passwordForm.newPassword !== passwordForm.confirm) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);
        setSuccess('');
        setError('');

        try {
            await api.post('/change-password', { newPassword: passwordForm.newPassword });
            setSuccess('Password changed successfully!');
            setPasswordForm({ newPassword: '', confirm: '' });
        } catch (err) {
            setError('Failed to change password.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="page-container">
            <div className="page-header" style={{ marginBottom: '2rem' }}>
                <div className="header-title-wrapper">
                    <button
                        onClick={() => navigate('/')}
                        className="btn-icon"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <h1 style={{ marginBottom: 0 }}>Configuration Settings</h1>
                </div>
            </div>

            {error && (
                <div className="alert alert-error">
                    <AlertCircle size={20} />
                    <span>{error}</span>
                </div>
            )}

            {success && (
                <div className="alert alert-success">
                    <CheckCircle size={20} />
                    <span>{success}</span>
                </div>
            )}

            <div className="settings-grid">
                {/* Settings Form */}
                <div className="settings-card">
                    <h2 className="settings-section-title">Host Details</h2>
                    <form onSubmit={handleSaveSettings}>
                        <div className="input-group">
                            <label>Host IP Address</label>
                            <input
                                type="text"
                                name="host_ip"
                                value={settings.host_ip}
                                onChange={handleChange}
                                className="text-input"
                                placeholder="172.17.0.1"
                                required
                            />
                            <p className="input-hint">IP for SSH from within Docker (often 172.17.0.1)</p>
                        </div>

                        <div className="input-group">
                            <label>SSH Username</label>
                            <input
                                type="text"
                                name="ssh_username"
                                value={settings.ssh_username}
                                onChange={handleChange}
                                className="text-input"
                                placeholder="root"
                                required
                            />
                        </div>

                        <div className="input-group">
                            <label>SSH Key Path</label>
                            <input
                                type="text"
                                name="ssh_key_path"
                                value={settings.ssh_key_path}
                                onChange={handleChange}
                                className="text-input"
                                placeholder="/root/.ssh/id_rsa"
                                required
                            />
                        </div>

                        <h2 className="settings-section-title" style={{ marginTop: '2rem' }}>Portainer Details</h2>

                        <div className="input-group">
                            <label>Portainer URL</label>
                            <input
                                type="text"
                                name="portainer_url"
                                value={settings.portainer_url}
                                onChange={handleChange}
                                className="text-input"
                                placeholder="http://localhost:9000"
                            />
                        </div>

                        <div className="input-group">
                            <label>Portainer API Token</label>
                            <input
                                type="password"
                                name="portainer_token"
                                value={settings.portainer_token}
                                onChange={handleChange}
                                className="text-input"
                                placeholder="ptr_..."
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary"
                            style={{ marginTop: '1.5rem' }}
                        >
                            <Save size={16} /> Save Configuration
                        </button>
                    </form>
                </div>

                {/* Change Password Form */}
                <div className="settings-card" style={{ height: 'fit-content' }}>
                    <h2 className="settings-section-title">Change Password</h2>
                    <form onSubmit={handlePasswordChange}>
                        <div className="input-group">
                            <label>New Password</label>
                            <input
                                type="password"
                                value={passwordForm.newPassword}
                                onChange={(e) => setPasswordForm(p => ({ ...p, newPassword: e.target.value }))}
                                className="text-input"
                                required
                            />
                        </div>

                        <div className="input-group">
                            <label>Confirm Password</label>
                            <input
                                type="password"
                                value={passwordForm.confirm}
                                onChange={(e) => setPasswordForm(p => ({ ...p, confirm: e.target.value }))}
                                className="text-input"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-outline"
                            style={{ marginTop: '1.5rem', width: '100%', justifyContent: 'center' }}
                        >
                            Update Password
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Settings;
