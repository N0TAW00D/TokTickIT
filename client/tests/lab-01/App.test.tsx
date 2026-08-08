import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/App.tsx';

const API_BASE_URL = 'http://localhost:3000';
const HEALTH_URL = `${API_BASE_URL}/api/health`;
const CATEGORIES_URL = `${API_BASE_URL}/api/categories`;

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const SEEDED_CATEGORIES = [
  { id: 1, name: 'Account and Access' },
  { id: 2, name: 'Hardware' },
  { id: 3, name: 'Software' },
  { id: 4, name: 'Network' },
];

function mockFetch({
  health = () => jsonResponse(200, { status: 'ok', service: 'TokTickIT API' }),
  categories = () => jsonResponse(200, SEEDED_CATEGORIES),
}: {
  health?: () => Promise<Response>;
  categories?: () => Promise<Response>;
} = {}) {
  const fetchMock = vi.fn((input: string) => {
    if (input === HEALTH_URL) return health();
    if (input === CATEGORIES_URL) return categories();
    return jsonResponse(404, {});
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TokTickIT heading', () => {
  it('UI-01: TokTickIT heading renders', () => {
    mockFetch();

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'TokTickIT IT Service Desk' }),
    ).toBeInTheDocument();
  });
});

describe('Check System button', () => {
  it('UI-02: shows a loading state, then Online status and the four categories', async () => {
    mockFetch();

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Check System' }));

    expect(screen.getByRole('status')).toHaveTextContent(/Loading/i);

    await waitFor(() => {
      expect(screen.getByText('Online')).toBeInTheDocument();
    });

    for (const category of SEEDED_CATEGORIES) {
      expect(screen.getByText(category.name)).toBeInTheDocument();
    }
  });

  it('UI-03: shows an Offline status and a useful error message when the API is unavailable', async () => {
    mockFetch({ health: () => Promise.reject(new Error('network down')) });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Check System' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Offline');
    expect(alert).toHaveTextContent('Unable to connect to TokTickIT API');
  });
});
