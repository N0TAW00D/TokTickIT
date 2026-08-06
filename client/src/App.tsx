import { useEffect, useState } from "react";
import "./App.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const ENDPOINTS = [
    "/", 
    "/api/health"
];

type EndpointResult = {
  path: string;
  status: number | "error";
  json: string;
};

function App() {
  
  const [results, setResults] = useState<EndpointResult[]>([]);

  useEffect(() => {
    let ignore = false;

    setResults([]);
    ENDPOINTS.forEach((path) => {
      fetch(`${API_BASE_URL}${path}`)
        .then(async (res) => {
          const text = await res.text();
          if (ignore) return;
          setResults((prev) => [
            ...prev,
            { path, status: res.status, json: text },
          ]);
        })
        .catch(() => {
          if (ignore) return;
          setResults((prev) => [
            ...prev,
            { path, status: "error", json: "Unable to connect to TokTickIT API" },
          ]);
        });
    });

    return () => {
      ignore = true;
    };
  }, []);

  return (
    <>
      <section style={{ margin: "1rem" }}>
        <div className="align-start" style={{ textAlign: "left" }}>
          <h1>Backend Status</h1>
          <p>
            The table below shows the current status of each endpoint.
          </p>
        </div>
        <table className="table" style={{ textAlign: "left" }}>
          <thead>
            <tr>
              <th scope="col">Endpoint</th>
              <th scope="col">Status</th>
              <th scope="col">Message</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={result.path}>
                <td>{result.path}</td>
                <td>{result.status}</td>
                <td>{result.json}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export default App;
