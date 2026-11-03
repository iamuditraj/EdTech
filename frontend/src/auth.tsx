import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { JwtPayload, Role } from "./types";
import { getToken, setToken as storeToken, clearToken, decodeJwt } from "./api";

// --- Auth context ---

interface AuthContextValue {
    user: JwtPayload | null;
    login: (token: string) => JwtPayload | null;
    logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromStorage(): JwtPayload | null {
    const token = getToken();
    if (!token) return null;
    const payload = decodeJwt(token);
    if (!payload) return null;
    if (payload.exp * 1000 < Date.now()) {
        clearToken();
        return null;
    }
    return payload;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<JwtPayload | null>(userFromStorage);

    const login = useCallback((token: string): JwtPayload | null => {
        storeToken(token);
        const payload = decodeJwt(token);
        setUser(payload);
        return payload;
    }, []);

    const logout = useCallback(() => {
        clearToken();
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
    return ctx;
}

// --- Route guard ---

const HOME: Record<Role, string> = {
    student: "/student",
    teacher: "/teacher",
    admin: "/admin/schools",
};

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
    const { user } = useAuth();
    const location = useLocation();

    if (!user) {
        const loginPath = role === "admin" ? "/admin/login" : "/login";
        return <Navigate to={loginPath} state={{ from: location }} replace />;
    }

    if (user.role !== role) {
        return <Navigate to={HOME[user.role]} replace />;
    }

    return <>{children}</>;
}

