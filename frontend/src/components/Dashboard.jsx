import React, { useState, useEffect } from 'react';
import { Shield, ShieldAlert, Server, Box, Edit2, Check, X, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const Dashboard = ({ onLogout }) => {
    const [data, setData] = useState({ ports: [], ufwActive: false });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editingPort, setEditingPort] = useState(null);
    const [editName, setEditName] = useState('');
    const navigate = useNavigate();

    const fetchData = async () => {
        try {
            setLoading(true);
            const res = await api.get('/ports');
            setData(res.data);
            setError(null);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load ports');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleEditName = async (port, protocol) => {
        try {
            await api.post('/custom-name', { port, protocol, name: editName });
            setEditingPort(null);
            fetchData();
        } catch (err) {
            alert('Failed to save name');
        }
    };

    const toggleUfw = async (portObj) => {
        try {
            if (portObj.ufwRules.length > 0) {
                // Delete rules
                for (const rule of portObj.ufwRules) {
                    await api.post('/ufw/delete', { ruleId: rule.id });
                }
            } else {
                // Allow port
                await api.post('/ufw/allow', { port: portObj.port, protocol: portObj.protocol });
            }
            fetchData();
        } catch (err) {
            alert('Failed to update UFW rules');
        }
    };

    if (loading && data.ports.length === 0) {
        return (
            <div className="loader-container">
                <div className="spinner"></div>
            </div>
        );
    }

    return (
        <div className="page-container">
            <div className="page-header">
                <div>
                    <h1 className="header-title-wrapper">
                        <Shield size={32} color="var(--accent-color)" />
                        PortWarden Dashboard
                    </h1>
                    <div className="status-badge">
                        Status:
                        {data.ufwActive ? (
                            <span className="status-badge status-active"><Check size={16} /> UFW Active</span>
                        ) : (
                            <span className="status-badge status-inactive"><ShieldAlert size={16} /> UFW Inactive</span>
                        )}
                    </div>
                </div>

                <div className="header-actions">
                    <button
                        onClick={() => navigate('/settings')}
                        className="btn-icon"
                        title="Settings"
                    >
                        <SettingsIcon size={20} />
                    </button>
                    <button
                        onClick={() => {
                            localStorage.removeItem('token');
                            onLogout();
                        }}
                        className="btn-danger"
                    >
                        <LogOut size={16} />
                        Logout
                    </button>
                </div>
            </div>

            {error && (
                <div className="alert alert-error">
                    <ShieldAlert size={20} />
                    {error}
                </div>
            )}

            <div className="table-card">
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Port / Protocol</th>
                                <th>Name</th>
                                <th>Source</th>
                                <th>UFW AllowList</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.ports.map((p) => {
                                const key = `${p.port}-${p.protocol}`;
                                const isEditing = editingPort === key;
                                const isAllowed = p.ufwRules.length > 0;

                                return (
                                    <tr key={key}>
                                        <td>
                                            <div className="port-cell">
                                                {p.port} <span className="port-proto">{p.protocol}</span>
                                            </div>
                                        </td>

                                        <td>
                                            {isEditing ? (
                                                <div className="name-input-wrapper">
                                                    <input
                                                        type="text"
                                                        className="name-input"
                                                        value={editName}
                                                        onChange={(e) => setEditName(e.target.value)}
                                                        autoFocus
                                                        onKeyDown={(e) => e.key === 'Enter' && handleEditName(p.port, p.protocol)}
                                                    />
                                                    <button onClick={() => handleEditName(p.port, p.protocol)} className="icon-btn icon-success"><Check size={16} /></button>
                                                    <button onClick={() => setEditingPort(null)} className="icon-btn icon-danger"><X size={16} /></button>
                                                </div>
                                            ) : (
                                                <div className="name-cell">
                                                    <span className={`name-text ${p.customName ? '' : 'unnamed'}`}>
                                                        {p.customName || 'Unnamed'}
                                                    </span>
                                                    <button
                                                        onClick={() => {
                                                            setEditingPort(key);
                                                            setEditName(p.customName || '');
                                                        }}
                                                        className="edit-btn"
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                </div>
                                            )}
                                        </td>

                                        <td>
                                            {p.docker ? (
                                                <div className="source-cell">
                                                    <Box size={16} color="var(--accent-color)" />
                                                    <span className="name-text truncate" title={p.docker.name}>{p.docker.name}</span>
                                                    <span className="source-tag source-docker">Docker</span>
                                                </div>
                                            ) : p.process ? (
                                                <div className="source-cell">
                                                    <Server size={16} color="var(--text-primary)" />
                                                    <span className="name-text truncate" title={p.process}>{p.process.split(' ')[0]}</span>
                                                    <span className="source-tag source-host">Host</span>
                                                </div>
                                            ) : (
                                                <span className="name-text unnamed">Inactive</span>
                                            )}
                                        </td>

                                        <td>
                                            {isAllowed ? (
                                                <div className="pill pill-allowed">
                                                    <Check size={16} />
                                                    <span>Allowed ({p.ufwRules.length})</span>
                                                </div>
                                            ) : (
                                                <div className="pill pill-blocked">
                                                    <X size={16} />
                                                    <span>Blocked</span>
                                                </div>
                                            )}
                                        </td>

                                        <td style={{ textAlign: 'right' }}>
                                            <button
                                                onClick={() => toggleUfw(p)}
                                                className={`btn-toggle ${isAllowed ? 'block' : 'allow'}`}
                                            >
                                                {isAllowed ? 'Block Port' : 'Allow Port'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}

                            {data.ports.length === 0 && !loading && (
                                <tr>
                                    <td colSpan="5">
                                        <div className="empty-state">
                                            <Shield className="empty-icon" />
                                            <p style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No ports found</p>
                                            <p>Make sure UFW and host scanning are correctly configured.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
