import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App.tsx';

const API_BASE_URL = 'http://localhost:3000';
const CATEGORIES_URL = `${API_BASE_URL}/api/categories`;

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response);
}

function mockCategories(respond: () => Promise<Response>) {
  const fetchMock = vi.fn((input: string) =>
    input === CATEGORIES_URL ? respond() : jsonResponse(200, {}),
  );

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Data rows (header row excluded) of the categories table. */
function categoryRows() {
  const section = screen
    .getByRole('heading', { name: 'Categories API' })
    .closest('section');
  if (!section) throw new Error('No section for the categories heading');
  return within(section).getAllByRole('row').slice(1);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Category list', () => {
  it('requests the categories endpoint on mount', async () => {
    const fetchMock = mockCategories(() => jsonResponse(200, []));

    render(<App />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(CATEGORIES_URL);
    });
  });

  it('shows a loading message until the request settles', () => {
    mockCategories(() => new Promise<Response>(() => {}));

    render(<App />);

    expect(screen.getByText('Loading categories…')).toBeInTheDocument();
  });

  it('renders one row per category, with its id and name', async () => {
    mockCategories(() =>
      jsonResponse(200, [
        { id: 1, name: 'Account and Access' },
        { id: 2, name: 'Hardware' },
      ]),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText('Loading categories…')).not.toBeInTheDocument();
    });

    const rows = categoryRows();
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Account and Access')).toBeInTheDocument();
    expect(within(rows[1]).getByText('2')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Hardware')).toBeInTheDocument();
  });

  it('renders the table with no rows when the API returns no categories', async () => {
    mockCategories(() => jsonResponse(200, []));

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText('Loading categories…')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(categoryRows()).toHaveLength(0);
  });

  it('shows an alert instead of the table when the request fails', async () => {
    mockCategories(() => jsonResponse(500, { error: 'boom' }));

    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unable to load categories from TokTickIT API');
    expect(screen.queryByRole('columnheader', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('shows an alert when the request rejects', async () => {
    mockCategories(() => Promise.reject(new Error('network down')));

    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unable to load categories from TokTickIT API');
  });
});
