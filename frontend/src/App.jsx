import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import Settings from './components/Settings'

// Protected Route wrapper
const ProtectedRoute = ({ children, isAuthenticated }) => {
    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }
    return children;
};

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check if token exists on mount
        const token = localStorage.getItem('token');
        if (token) {
            setIsAuthenticated(true);
        }
        setLoading(false);
    }, []);

    const handleLogin = () => {
        setIsAuthenticated(true);
    };

    const handleLogout = () => {
        setIsAuthenticated(false);
    };

    if (loading) {
        return (
            <div className="loader-container">
                <div className="spinner" />
            </div>
        );
    }

    return (
        <BrowserRouter>
            <div className="app-container">
                <Routes>
                    <Route
                        path="/login"
                        element={isAuthenticated ? <Navigate to="/" replace /> : <Login onLogin={handleLogin} />}
                    />
                    <Route
                        path="/"
                        element={
                            <ProtectedRoute isAuthenticated={isAuthenticated}>
                                <Dashboard onLogout={handleLogout} />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/settings"
                        element={
                            <ProtectedRoute isAuthenticated={isAuthenticated}>
                                <Settings />
                            </ProtectedRoute>
                        }
                    />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </div>
        </BrowserRouter>
    )
}

export default App
