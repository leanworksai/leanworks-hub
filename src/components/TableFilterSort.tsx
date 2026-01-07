import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Filter, ArrowUp, ArrowDown, X } from 'lucide-react';
import type { FilterType, SortType, FilterConfig } from '@/hooks/useTableFilterSort';

interface TableFilterSortProps {
  tableId: string;
  columnIndex: number;
  currentFilter?: FilterConfig;
  currentSort?: SortType;
  onFilterChange: (filter: FilterConfig | undefined) => void;
  onSortChange: (sort: SortType) => void;
}

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'lt', label: 'Less Than' },
];

export function TableFilterSort({
  tableId,
  columnIndex,
  currentFilter,
  currentSort,
  onFilterChange,
  onSortChange,
}: TableFilterSortProps) {
  const [filterType, setFilterType] = useState<FilterType>(currentFilter?.type || 'contains');
  const [filterValue, setFilterValue] = useState(currentFilter?.value || '');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Get the overlay element to use as portal container
  useEffect(() => {
    const overlay = document.querySelector(`[data-table-id="${tableId}"][data-column-index="${columnIndex}"]`) as HTMLElement;
    if (overlay) {
      containerRef.current = overlay;
    }
  }, [tableId, columnIndex]);

  // Notify parent overlay when dropdown state changes
  const handleDropdownOpenChange = (open: boolean) => {
    const overlay = document.querySelector(`[data-table-id="${tableId}"][data-column-index="${columnIndex}"]`);
    if (overlay) {
      const event = new CustomEvent(open ? 'dropdown-open' : 'dropdown-close');
      overlay.dispatchEvent(event);
    }
  };

  useEffect(() => {
    if (currentFilter) {
      setFilterType(currentFilter.type);
      setFilterValue(currentFilter.value);
    } else {
      setFilterValue('');
    }
  }, [currentFilter]);

  const handleApplyFilter = () => {
    if (filterValue.trim()) {
      onFilterChange({ type: filterType, value: filterValue.trim() });
      setIsFilterOpen(false);
    }
  };

  const handleClearFilter = () => {
    setFilterValue('');
    onFilterChange(undefined);
    setIsFilterOpen(false);
  };

  const handleSortAsc = () => {
    onSortChange(currentSort === 'asc' ? null : 'asc');
  };

  const handleSortDesc = () => {
    onSortChange(currentSort === 'desc' ? null : 'desc');
  };

  const hasActiveFilter = !!currentFilter;
  const hasActiveSort = !!currentSort;

  return (
    <DropdownMenu onOpenChange={handleDropdownOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          className="table-filter-icon inline-flex items-center justify-center rounded-sm p-1 hover:bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary"
          aria-label="Filter and sort column"
          onClick={(e) => e.stopPropagation()}
        >
          <Filter 
            className={`h-3.5 w-3.5 ${hasActiveFilter || hasActiveSort ? 'text-primary' : 'text-muted-foreground'}`} 
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="start" 
        className="w-56 !fixed" 
        onClick={(e) => e.stopPropagation()}
        sideOffset={5}
        alignOffset={-5}
        strategy="fixed"
        container={document.body}
        style={{ position: 'fixed' } as any}
      >
        <DropdownMenuLabel>Sort</DropdownMenuLabel>
        <DropdownMenuItem onClick={handleSortAsc}>
          <ArrowUp className={`h-4 w-4 mr-2 ${currentSort === 'asc' ? 'text-primary' : ''}`} />
          <span className={currentSort === 'asc' ? 'font-semibold' : ''}>
            Sort Ascending
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSortDesc}>
          <ArrowDown className={`h-4 w-4 mr-2 ${currentSort === 'desc' ? 'text-primary' : ''}`} />
          <span className={currentSort === 'desc' ? 'font-semibold' : ''}>
            Sort Descending
          </span>
        </DropdownMenuItem>
        {currentSort && (
          <DropdownMenuItem onClick={() => onSortChange(null)}>
            <X className="h-4 w-4 mr-2" />
            <span>Clear Sort</span>
          </DropdownMenuItem>
        )}
        
        <DropdownMenuSeparator />
        
        <DropdownMenuLabel>Filter</DropdownMenuLabel>
        <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <PopoverTrigger asChild>
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
              <Filter className="h-4 w-4 mr-2" />
              <span className={hasActiveFilter ? 'font-semibold' : ''}>
                {hasActiveFilter ? 'Edit Filter' : 'Add Filter'}
              </span>
            </DropdownMenuItem>
          </PopoverTrigger>
          <PopoverContent 
            className="w-80 !fixed" 
            align="start" 
            side="right"
            onClick={(e) => e.stopPropagation()}
            strategy="fixed"
            container={document.body}
            style={{ position: 'fixed' } as any}
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="filter-type">Filter Type</Label>
                <select
                  id="filter-type"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as FilterType)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="filter-value">Value</Label>
                <Input
                  id="filter-value"
                  placeholder="Enter filter value..."
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleApplyFilter();
                    }
                  }}
                />
              </div>
              
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleApplyFilter}
                  disabled={!filterValue.trim()}
                  className="flex-1"
                >
                  Apply Filter
                </Button>
                {hasActiveFilter && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleClearFilter}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        
        {currentFilter && (
          <DropdownMenuItem onClick={handleClearFilter}>
            <X className="h-4 w-4 mr-2" />
            <span>Clear Filter</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TableFilterIconProps {
  hasActiveFilter: boolean;
  hasActiveSort: boolean;
}

export function TableFilterIcon({ hasActiveFilter, hasActiveSort }: TableFilterIconProps) {
  return (
    <div className="table-filter-icon-wrapper">
      <Filter 
        className={`h-3.5 w-3.5 ${hasActiveFilter || hasActiveSort ? 'text-primary' : 'text-muted-foreground'}`} 
      />
    </div>
  );
}

