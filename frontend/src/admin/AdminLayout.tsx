import { NavLink, Outlet } from "react-router-dom";
import { Header } from "../ui";

const tabs = ["schools", "classes", "videos", "subscriptions", "teachers", "students"] as const;

export function AdminLayout() {
    return (
        <div className="min-h-screen bg-slate-50">
            <Header />
            <nav className="flex gap-4 overflow-x-auto border-b border-slate-200 bg-white px-4 text-sm">
                {tabs.map((t) => (
                    <NavLink
                        key={t}
                        to={`/admin/${t}`}
                        className={({ isActive }) =>
                            `whitespace-nowrap py-2 ${isActive ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-500 hover:text-slate-700"}`
                        }
                    >
                        {t[0].toUpperCase() + t.slice(1)}
                    </NavLink>
                ))}
            </nav>
            <main className="p-4">
                <Outlet />
            </main>
        </div>
    );
}
