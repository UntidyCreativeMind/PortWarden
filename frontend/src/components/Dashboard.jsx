import React, { useState, useEffect, useMemo } from 'react';
import { Shield, ShieldAlert, Server, Box, Edit2, Check, X, LogOut, Settings as SettingsIcon, ArrowUp, ArrowDown, ArrowUpDown, RefreshCw, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const PROTOCOL_OPTIONS = [
    { value: 'both', label: 'TCP + UDP', tcp: true, udp: true },
    { value: 'tcp', label: 'TCP', tcp: true, udp: false },
    { value: 'udp', label: 'UDP', tcp: false, udp: true }
];

const SORT_STORAGE_KEY = 'portwarden.sort';

// Default protocol selection for a row: whatever is actually listening, or both if unknown
const defaultSelection = (p) => {
    if (p.listening.tcp && !p.listening.udp) return 'tcp';
    if (p.listening.udp && !p.listening.tcp) return 'udp';
    return 'both';
};

const sourceLabel = (p) => p.docker?.name || p.process?.split(' ')[0] || '';

// Sort value for each column; protocol columns rank TCP+UDP > TCP > UDP > none
const protoRank = ({ tcp, udp }) => (tcp ? 2 : 0) + (udp ? 1 : 0);
const SORTERS = {
    port: (p) => p.port,
    name: (p) => p.customName?.toLowerCase() || null,
    source: (p) => sourceLabel(p).toLowerCase() || null,
    listening: (p) => protoRank(p.listening),
    ufw: (p) => protoRank(p.allowed)
};

const loadSort = () => {
    try {
        const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY));
        if (saved && SORTERS[saved.key] && (saved.dir === 'asc' || saved.dir === 'desc')) return saved;
    } catch (e) { /* ignore */ }
    return { key: 'port', dir: 'asc' };
};

const ProtocolBadges = ({ flags, variant }) => (
    <div className="proto-badges">
        {['tcp', 'udp'].map(proto => (
            <span
                key={proto}
                className={`proto-badge ${flags[proto] ? `proto-on-${variant}` : 'proto-off'}`}
                title={`${proto.toUpperCase()} ${flags[proto] ? (variant === 'allowed' ? 'allowed' : 'listening') : (variant === 'allowed' ? 'blocked' : 'not listening')}`}
            >
                {flags[proto] ? <Check size={12} /> : <X size={12} />}
                {proto.toUpperCase()}
            </span>
        ))}
    </div>
);

const ProtocolSelect = ({ value, onChange, disabled }) => (
    <select
        className="proto-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Protocol"
    >
        {PROTOCOL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
);

const Dashboard = ({ onLogout }) => {
    const [data, setData] = useState({ ports: [], ufwActive: false, errors: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editingPort, setEditingPort] = useState(null);
    const [editName, setEditName] = useState('');
    const [manualPort, setManualPort] = useState('');
    const [manualProto, setManualProto] = useState('both');
    const [selections, setSelections] = useState({});
    const [busyPort, setBusyPort] = useState(null);
    const [sort, setSort] = useState(loadSort);
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

    useEffect(() => {
        try {
            localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
        } catch (e) { /* ignore */ }
    }, [sort]);

    const sortedPorts = useMemo(() => {
        const getValue = SORTERS[sort.key];
        const factor = sort.dir === 'asc' ? 1 : -1;
        return [...data.ports].sort((a, b) => {
            const va = getValue(a);
            const vb = getValue(b);
            // Empty values always sink to the bottom
            if (va === null && vb !== null) return 1;
            if (vb === null && va !== null) return -1;
            if (va !== vb && va !== null) {
                const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
                if (cmp !== 0) return cmp * factor;
            }
            return a.port - b.port;
        });
    }, [data.ports, sort]);

    const toggleSort = (key) => {
        setSort(prev => prev.key === key
            ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: 'asc' });
    };

    const sortHeader = (column, label) => {
        const active = sort.key === column;
        const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
        return (
            <th key={column} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button className={`sort-btn ${active ? 'active' : ''}`} onClick={() => toggleSort(column)}>
                    {label}
                    <Icon size={14} />
                </button>
            </th>
        );
    };

    const handleEditName = async (port) => {
        try {
            await api.post('/custom-name', { port, name: editName });
            setEditingPort(null);
            fetchData();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to save name');
        }
    };

    const setUfw = async (port, desired) => {
        setBusyPort(port);
        try {
            await api.post('/ufw/set', { port, tcp: desired.tcp, udp: desired.udp });
            await fetchData();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to update UFW rules');
        } finally {
            setBusyPort(null);
        }
    };

    // Allow adds the selected protocols to what's already allowed; Block removes them
    const applyRule = (p, action) => {
        const sel = PROTOCOL_OPTIONS.find(o => o.value === (selections[p.port] || defaultSelection(p)));
        const desired = action === 'allow'
            ? { tcp: p.allowed.tcp || sel.tcp, udp: p.allowed.udp || sel.udp }
            : { tcp: p.allowed.tcp && !sel.tcp, udp: p.allowed.udp && !sel.udp };
        setUfw(p.port, desired);
    };

    const addManualRule = async () => {
        const port = parseInt(manualPort, 10);
        if (!(port >= 1 && port <= 65535)) {
            alert('Port must be between 1 and 65535');
            return;
        }
        const existing = data.ports.find(p => p.port === port)?.allowed || { tcp: false, udp: false };
        const sel = PROTOCOL_OPTIONS.find(o => o.value === manualProto);
        await setUfw(port, { tcp: existing.tcp || sel.tcp, udp: existing.udp || sel.udp });
        setManualPort('');
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
                        onClick={fetchData}
                        className="btn-icon"
                        title="Refresh"
                        disabled={loading}
                    >
                        <RefreshCw size={20} className={loading ? 'spin' : ''} />
                    </button>
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

            {data.errors?.length > 0 && (
                <div className="alert alert-warning">
                    <AlertTriangle size={20} />
                    <div>
                        {data.errors.map((e, i) => <div key={i}>{e}</div>)}
                    </div>
                </div>
            )}

            <div className="table-card">
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                {sortHeader('port', 'Port')}
                                {sortHeader('name', 'Name')}
                                {sortHeader('source', 'Source')}
                                {sortHeader('listening', 'Listening')}
                                {sortHeader('ufw', 'UFW Allowed')}
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedPorts.map((p) => {
                                const key = `${p.port}`;
                                const isEditing = editingPort === key;
                                const selection = selections[p.port] || defaultSelection(p);
                                const sel = PROTOCOL_OPTIONS.find(o => o.value === selection);
                                const canAllow = (sel.tcp && !p.allowed.tcp) || (sel.udp && !p.allowed.udp);
                                const canBlock = (sel.tcp && p.allowed.tcp) || (sel.udp && p.allowed.udp);
                                const busy = busyPort === p.port;

                                return (
                                    <tr key={key}>
                                        <td>
                                            <div className="port-cell">{p.port}</div>
                                        </td>

                                        <td>
                                            {isEditing ? (
                                                <div className="name-input-wrapper">
                                                    <input
                                                        type="text"
                                                        className="name-input"
                                                        value={editName}
                                                        maxLength={64}
                                                        onChange={(e) => setEditName(e.target.value)}
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleEditName(p.port);
                                                            if (e.key === 'Escape') setEditingPort(null);
                                                        }}
                                                    />
                                                    <button onClick={() => handleEditName(p.port)} className="icon-btn icon-success"><Check size={16} /></button>
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
                                                        title="Rename"
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
                                            <ProtocolBadges flags={p.listening} variant="listening" />
                                        </td>

                                        <td>
                                            <ProtocolBadges flags={p.allowed} variant="allowed" />
                                        </td>

                                        <td style={{ textAlign: 'right' }}>
                                            <div className="action-cell">
                                                <ProtocolSelect
                                                    value={selection}
                                                    onChange={(v) => setSelections(s => ({ ...s, [p.port]: v }))}
                                                    disabled={busy}
                                                />
                                                <button
                                                    onClick={() => applyRule(p, 'allow')}
                                                    className="btn-toggle allow"
                                                    disabled={busy || !canAllow}
                                                >
                                                    Allow
                                                </button>
                                                <button
                                                    onClick={() => applyRule(p, 'block')}
                                                    className="btn-toggle block"
                                                    disabled={busy || !canBlock}
                                                >
                                                    Block
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}

                            <tr className="manual-entry-row" style={{ backgroundColor: 'var(--bg-secondary)', borderTop: '2px dashed var(--border-color)' }}>
                                <td>
                                    <div className="port-cell">
                                        <input
                                            type="number"
                                            className="name-input"
                                            placeholder="Port (e.g. 8080)"
                                            min="1"
                                            max="65535"
                                            value={manualPort}
                                            onChange={(e) => setManualPort(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && manualPort && addManualRule()}
                                            style={{ width: '130px' }}
                                        />
                                    </div>
                                </td>
                                <td>
                                    <span className="unnamed">Manual Entry</span>
                                </td>
                                <td>
                                    <span className="name-text unnamed">Inactive</span>
                                </td>
                                <td></td>
                                <td>
                                    <div className="pill pill-blocked" style={{ opacity: 0.5 }}>
                                        <span>Pending Rules</span>
                                    </div>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <div className="action-cell">
                                        <ProtocolSelect value={manualProto} onChange={setManualProto} />
                                        <button
                                            onClick={addManualRule}
                                            className="btn-toggle allow"
                                            disabled={!manualPort || busyPort !== null}
                                        >
                                            Allow
                                        </button>
                                    </div>
                                </td>
                            </tr>

                            {data.ports.length === 0 && !loading && (
                                <tr>
                                    <td colSpan="6">
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
