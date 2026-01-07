import { useState, useCallback, useMemo } from 'react';

export type FilterType = 'equals' | 'notEquals' | 'gt' | 'lt' | 'contains';
export type SortType = 'asc' | 'desc' | null;

export interface FilterConfig {
  type: FilterType;
  value: string;
}

export interface ColumnConfig {
  filter?: FilterConfig;
  sort?: SortType;
}

export interface TableConfig {
  [columnIndex: string]: ColumnConfig;
}

export interface FilterSortState {
  [tableId: string]: TableConfig;
}

export function useTableFilterSort() {
  const [state, setState] = useState<FilterSortState>({});

  const setFilter = useCallback((tableId: string, columnIndex: number, filter: FilterConfig | undefined) => {
    setState((prev) => {
      const newState = { ...prev };
      if (!newState[tableId]) {
        newState[tableId] = {};
      }
      if (!newState[tableId][columnIndex]) {
        newState[tableId][columnIndex] = {};
      }
      newState[tableId][columnIndex].filter = filter;
      return newState;
    });
  }, []);

  const setSort = useCallback((tableId: string, columnIndex: number, sort: SortType) => {
    setState((prev) => {
      const newState = { ...prev };
      if (!newState[tableId]) {
        newState[tableId] = {};
      }
      if (!newState[tableId][columnIndex]) {
        newState[tableId][columnIndex] = {};
      }
      newState[tableId][columnIndex].sort = sort;
      return newState;
    });
  }, []);

  const clearFilter = useCallback((tableId: string, columnIndex: number) => {
    setState((prev) => {
      const newState = { ...prev };
      if (newState[tableId]?.[columnIndex]) {
        delete newState[tableId][columnIndex].filter;
        if (!newState[tableId][columnIndex].sort) {
          delete newState[tableId][columnIndex];
        }
      }
      return newState;
    });
  }, []);

  const clearSort = useCallback((tableId: string, columnIndex: number) => {
    setState((prev) => {
      const newState = { ...prev };
      if (newState[tableId]?.[columnIndex]) {
        delete newState[tableId][columnIndex].sort;
        if (!newState[tableId][columnIndex].filter) {
          delete newState[tableId][columnIndex];
        }
      }
      return newState;
    });
  }, []);

  const clearAll = useCallback((tableId: string) => {
    setState((prev) => {
      const newState = { ...prev };
      delete newState[tableId];
      return newState;
    });
  }, []);

  const getColumnConfig = useCallback((tableId: string, columnIndex: number): ColumnConfig | undefined => {
    return state[tableId]?.[columnIndex];
  }, [state]);

  const getTableConfig = useCallback((tableId: string): TableConfig | undefined => {
    return state[tableId];
  }, [state]);

  return {
    state,
    setFilter,
    setSort,
    clearFilter,
    clearSort,
    clearAll,
    getColumnConfig,
    getTableConfig,
  };
}

