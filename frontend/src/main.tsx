import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider, RequireRole, useAuth } from "./auth";
import { LoginPage, AdminLoginPage } from "./Login";
import { StudentVideoList, StudentVideoPlayer } from "./Student";
import { TeacherDashboard } from "./Teacher";
import { AdminLayout } from "./admin/AdminLayout";
import { Schools } from "./admin/Schools";
import { Classes } from "./admin/Classes";
import { Videos } from "./admin/Videos";
import { Subscriptions } from "./admin/Subscriptions";
import { Teachers } from "./admin/Teachers";
import { Students } from "./admin/Students";

function RootRedirect() {
    const { user } = useAuth();
    if (!user) return <Navigate to="/login" replace />;
    if (user.role === "admin") return <Navigate to="/admin/schools" replace />;
    if (user.role === "teacher") return <Navigate to="/teacher" replace />;
    return <Navigate to="/student" replace />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <BrowserRouter>
            <AuthProvider>
                <Routes>
                    {/* Public */}
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/admin/login" element={<AdminLoginPage />} />

                    {/* Student */}
                    <Route path="/student" element={<RequireRole role="student"><StudentVideoList /></RequireRole>} />
                    <Route path="/student/videos/:id" element={<RequireRole role="student"><StudentVideoPlayer /></RequireRole>} />

                    {/* Teacher */}
                    <Route path="/teacher" element={<RequireRole role="teacher"><TeacherDashboard /></RequireRole>} />

                    {/* Admin */}
                    <Route path="/admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
                        <Route index element={<Navigate to="schools" replace />} />
                        <Route path="schools" element={<Schools />} />
                        <Route path="classes" element={<Classes />} />
                        <Route path="videos" element={<Videos />} />
                        <Route path="subscriptions" element={<Subscriptions />} />
                        <Route path="teachers" element={<Teachers />} />
                        <Route path="students" element={<Students />} />
                    </Route>

                    {/* Catch-all */}
                    <Route path="*" element={<RootRedirect />} />
                </Routes>
            </AuthProvider>
        </BrowserRouter>
    </React.StrictMode>
);
