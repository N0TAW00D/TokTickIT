import { useState } from "react";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

type Category = {
  id: number;
  name: string;
};

type CheckState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "online"; categories: Category[] }
  | { phase: "offline" };

function App() {
  const [state, setState] = useState<CheckState>({ phase: "idle" });

  async function checkSystem() {
    setState({ phase: "loading" });

    try {
      const healthRes = await fetch(`${API_BASE_URL}/api/health`);
      if (!healthRes.ok) throw new Error("health check failed");

      const categoriesRes = await fetch(`${API_BASE_URL}/api/categories`);
      if (!categoriesRes.ok) throw new Error("categories request failed");
      const categories: Category[] = await categoriesRes.json();

      setState({ phase: "online", categories });
    } catch {
      setState({ phase: "offline" });
    }
  }

  return (
    <div className="container py-4" style={{ textAlign: "left" }}>
      <h1>TokTickIT IT Service Desk</h1>

      <button className="btn btn-primary my-3" onClick={checkSystem}>
        Check System
      </button>

      {state.phase === "loading" && <p role="status">⏳ Loading…</p>}

      {state.phase === "online" && (
        <div>
          <p>
            System Status: <strong>Online</strong>
          </p>
          <p className="mb-1">Supported Request Categories:</p>
          <ul>
            {state.categories.map((category) => (
              <li key={category.id}>{category.name}</li>
            ))}
          </ul>
        </div>
      )}

      {state.phase === "offline" && (
        <div role="alert">
          <p>
            System Status: <strong>Offline</strong>
          </p>
          <p>Unable to connect to TokTickIT API</p>
        </div>
      )}
    </div>
  );
}

export default App;
