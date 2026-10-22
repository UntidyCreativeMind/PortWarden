import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Save, AlertCircle, CheckCircle, Download, Upload, KeyRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const Settings = () => {
    const [settings, setSettings] = useState({
        host_ip: '',
        ssh_username: '',
        ssh_password: '',
        ssh_key_path: ''
    });
    const [passwordSet, setPasswordSet] = useState(false);
    const [clearPassword, setClearPassword] = useState(false);
    const [hostFingerprint, setHostFingerprint] = useState(null);

    const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });

    const [restoreFile, setRestoreFile] = useState(null);
    const [restoreMode, setRestoreMode] = useState('merge');
    const [restoreSettings, setRestoreSettings] = useState(false);
    const fileInputRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState('');
    const [error, setError] = useState('');

    const navigate = useNavigate();

    const fetchSettings = async () => {
        try {
            const res = await api.get('/settings');
            const { ssh_password_set, ssh_host_fingerprint, ...rest } = res.data;
            setSettings(prev => ({ ...prev, ...rest, ssh_password: '' }));
            setPasswordSet(ssh_password_set);
            setHostFingerprint(ssh_host_fingerprint);
            setClearPassword(false);
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        fetchSettings();
    }, []);

    const showResult = (ok, message) => {
        setSuccess(ok ? message : '');
        setError(ok ? '' : message);
    };

    const handleChange = (e) => {
        setSettings(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            await api.post('/settings', { ...settings, clear_ssh_password: clearPassword });
            showResult(true, 'Settings saved successfully!');
            fetchSettings();
        } catch (err) {
            showResult(false, err.response?.data?.error || 'Failed to save settings.');
        } finally {
            setLoading(false);
        }
    };

    const handleResetHostKey = async () => {
        if (!confirm('Forget the pinned SSH host key? The next connection will trust whatever key the host presents.')) return;
        try {
            await api.post('/settings/reset-host-key');
            showResult(true, 'Pinned host key cleared.');
            fetchSettings();
        } catch (err) {
            showResult(false, 'Failed to reset host key.');
        }
    };

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (passwordForm.newPassword !== passwordForm.confirm) {
            showResult(false, 'Passwords do not match');
            return;
        }

        setLoading(true);

        try {
            await api.post('/change-password', {
                currentPassword: passwordForm.currentPassword,
                newPassword: passwordForm.newPassword
            });
            showResult(true, 'Password changed successfully!');
            setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' });
        } catch (err) {
            showResult(false, err.response?.data?.error || 'Failed to change password.');
        } finally {
            setLoading(false);
        }
    };

    const handleBackup = async () => {
        try {
            const res = await api.get('/backup');
            const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `portwarden-backup-${res.data.createdAt.slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            showResult(false, 'Failed to create backup.');
        }
    };

    const handleRestore = async (e) => {
        e.preventDefault();
        if (!restoreFile) return;
        if (restoreMode === 'replace' && !confirm('Replace mode deletes all current custom names before restoring. Continue?')) return;

        setLoading(true);
        try {
            let backup;
            try {
                backup = JSON.parse(await restoreFile.text());
            } catch {
                throw new Error('File is not valid JSON');
            }
            const res = await api.post('/restore', { backup, mode: restoreMode, includeSettings: restoreSettings });
            const { restored, skipped, settingsRestored } = res.data;
            let message = `Restored ${restored} custom name${restored === 1 ? '' : 's'}`;
            if (skipped) message += ` (${skipped} invalid entr${skipped === 1 ? 'y' : 'ies'} skipped)`;
            if (settingsRestored) message += ' and connection settings';
            showResult(true, `${message}.`);
            setRestoreFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            fetchSettings();
        } catch (err) {
            showResult(false, err.response?.data?.error || err.message || 'Restore failed.');
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
                {/* Host Details Form */}
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
                                placeholder="portwarden"
                                required
                            />
                            <p className="input-hint">Use a dedicated non-root user with sudo limited to ufw and ss</p>
                        </div>

                        <div className="input-group">
                            <label>SSH Password (Leave blank to use Key Path)</label>
                            <input
                                type="password"
                                name="ssh_password"
                                value={settings.ssh_password}
                                onChange={handleChange}
                                className="text-input"
                                placeholder={passwordSet ? 'Saved (leave blank to keep)' : '••••••••'}
                                autoComplete="new-password"
                                disabled={clearPassword}
                            />
                            {passwordSet && (
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={clearPassword}
                                        onChange={(e) => setClearPassword(e.target.checked)}
                                    />
                                    Remove saved password (use key instead)
                                </label>
                            )}
                        </div>

                        <div className="input-group">
                            <label>SSH Key Path</label>
                            <input
                                type="text"
                                name="ssh_key_path"
                                value={settings.ssh_key_path}
                                onChange={handleChange}
                                className="text-input"
                                placeholder="/root/.ssh/id_ed25519"
                            />
                        </div>

                        <div className="input-group">
                            <label>Pinned Host Key (SHA256)</label>
                            <div className="fingerprint-row">
                                <code className="fingerprint">{hostFingerprint || 'Not pinned yet (pinned on next connection)'}</code>
                                {hostFingerprint && (
                                    <button type="button" className="btn-outline btn-small" onClick={handleResetHostKey}>
                                        <KeyRound size={14} /> Reset
                                    </button>
                                )}
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary"
                            style={{ marginTop: '1.5rem' }}
                        >
                            <Save size={16} /> Save Settings
                        </button>
                    </form>
                </div>

                <div className="settings-column">
                    {/* Change Password Form */}
                    <div className="settings-card" style={{ height: 'fit-content' }}>
                        <h2 className="settings-section-title">Change Password</h2>
                        <form onSubmit={handlePasswordChange}>
                            <div className="input-group">
                                <label>Current Password</label>
                                <input
                                    type="password"
                                    value={passwordForm.currentPassword}
                                    onChange={(e) => setPasswordForm(p => ({ ...p, currentPassword: e.target.value }))}
                                    className="text-input"
                                    autoComplete="current-password"
                                    required
                                />
                            </div>

                            <div className="input-group">
                                <label>New Password</label>
                                <input
                                    type="password"
                                    value={passwordForm.newPassword}
                                    onChange={(e) => setPasswordForm(p => ({ ...p, newPassword: e.target.value }))}
                                    className="text-input"
                                    autoComplete="new-password"
                                    minLength={8}
                                    required
                                />
                                <p className="input-hint">At least 8 characters</p>
                            </div>

                            <div className="input-group">
                                <label>Confirm Password</label>
                                <input
                                    type="password"
                                    value={passwordForm.confirm}
                                    onChange={(e) => setPasswordForm(p => ({ ...p, confirm: e.target.value }))}
                                    className="text-input"
                                    autoComplete="new-password"
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

                    {/* Backup & Restore */}
                    <div className="settings-card" style={{ height: 'fit-content' }}>
                        <h2 className="settings-section-title">Backup &amp; Restore</h2>
                        <p className="input-hint" style={{ marginTop: 0, marginBottom: '1rem' }}>
                            Saves your custom port names and host connection settings to a file so they survive a reinstall.
                            The SSH password and login accounts are not included.
                        </p>

                        <button
                            type="button"
                            onClick={handleBackup}
                            className="btn-outline"
                            style={{ width: '100%', justifyContent: 'center' }}
                        >
                            <Download size={16} /> Download Backup
                        </button>

                        <form onSubmit={handleRestore} style={{ marginTop: '1.5rem' }}>
                            <div className="input-group">
                                <label>Restore from file</label>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="application/json,.json"
                                    onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                                    className="text-input"
                                />
                            </div>

                            <div className="input-group">
                                <label>Mode</label>
                                <select
                                    value={restoreMode}
                                    onChange={(e) => setRestoreMode(e.target.value)}
                                    className="text-input"
                                >
                                    <option value="merge">Merge (keep existing names, overwrite matching ports)</option>
                                    <option value="replace">Replace (delete existing names first)</option>
                                </select>
                            </div>

                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={restoreSettings}
                                    onChange={(e) => setRestoreSettings(e.target.checked)}
                                />
                                Also restore host connection settings
                            </label>

                            <button
                                type="submit"
                                disabled={loading || !restoreFile}
                                className="btn-outline"
                                style={{ marginTop: '1.5rem', width: '100%', justifyContent: 'center' }}
                            >
                                <Upload size={16} /> Restore
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Settings;
