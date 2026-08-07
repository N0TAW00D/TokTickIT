import { useEffect, useState } from "react";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const ENDPOINTS = [
  "/",
  "/api/health"
];

type EndpointResult = {
  path: string;
  status: number | "error";
  json: string;
};

type Category = {
  id: number;
  name: string;
};

function App() {
  const [results, setResults] = useState<EndpointResult[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(true);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoadingResults(true);
    setResultsError(null);

    Promise.all(
      ENDPOINTS.map((path) =>
        fetch(`${API_BASE_URL}${path}`)
          .then(async (res) => ({
            path,
            status: res.status,
            json: await res.text(),
          }))
          .catch(
            (): EndpointResult => ({
              path,
              status: "error",
              json: "Unable to connect to TokTickIT API",
            }),
          ),
      ),
    )
      .then(setResults)
      .catch(() => {
        setResultsError("Unable to load endpoint statuses");
      })
      .finally(() => {
        setIsLoadingResults(false);
      });
  }, []);

  useEffect(() => {
    setIsLoadingCategories(true);
    setCategoriesError(null);

    fetch(`${API_BASE_URL}/api/categories`)
      .then(async (res) => {
        if (!res.ok)
          throw new Error(`Request failed with status ${res.status}`);
        const data: Category[] = await res.json();
        setCategories(data);
      })
      .catch(() => {
        setCategoriesError("Unable to connect to TokTickIT API");
      })
      .finally(() => {
        setIsLoadingCategories(false);
      });
  }, []);

  return (
    <>
      <section style={{ margin: "1rem" }}>
        <div className="align-start" style={{ textAlign: "left" }}>
          <h1>Backend Status</h1>
          <p>The table below shows the current status of each endpoint.</p>
        </div>
        {isLoadingResults ? (
          <p role="status">Loading endpoint statuses…</p>
        ) : resultsError ? (
          <p role="alert">{resultsError}</p>
        ) : (
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
        )}
      </section>
      <section style={{ margin: "1rem" }}>
        <div className="align-start" style={{ textAlign: "left" }}>
          <h1>Categories API</h1>
          <p>
            The table below shows the current status of the categories endpoint.
          </p>
        </div>
        {isLoadingCategories ? (
          <p role="status">Loading categories…</p>
        ) : categoriesError ? (
          <p role="alert">{categoriesError}</p>
        ) : (
          <table className="table" style={{ textAlign: "left" }}>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Name</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td>{category.id}</td>
                  <td>{category.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export default App;
