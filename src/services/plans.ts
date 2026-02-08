/**
 * Plans CRUD API Service Layer
 * Handles communication with backend for plan CRUD operations
 */

import { authenticatedFetch } from '@/services/api';
import type {
  CreatePlanInput,
  UpdatePlanInput,
  CreateObjectiveInput,
  CreateBudgetCategoryInput,
  CreateResourceAllocationInput,
  CreateMilestoneInput,
} from '@/types/plans';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

const buildUrl = (path: string) =>
  import.meta.env.DEV ? `${API_BASE}/api${path}` : `${API_BASE}${path}`;

export const plansApi = {
  // ============================================================================
  // PLANS CRUD
  // ============================================================================

  /**
   * Get all plans with optional filters
   */
  async getAll(filters?: {
    status?: string;
    search?: string;
    sortBy?: 'name' | 'health' | 'budget' | 'timeline';
  }) {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.sortBy) params.append('sortBy', filters.sortBy);
    
    const queryString = params.toString();
    const url = queryString ? `${buildUrl('/plans')}?${queryString}` : buildUrl('/plans');
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch plans');
    return response.json();
  },

  /**
   * Get single plan with all nested data
   */
  async getById(planId: string) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}`);
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch plan');
    return response.json();
  },

  /**
   * Create new plan
   */
  async create(data: CreatePlanInput) {
    const url = buildUrl('/plans');
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create plan');
    return response.json();
  },

  /**
   * Update plan
   */
  async update(planId: string, data: UpdatePlanInput) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}`);
    const response = await authenticatedFetch(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update plan');
    return response.json();
  },

  /**
   * Delete plan
   */
  async delete(planId: string) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}`);
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete plan');
    return response.json();
  },

  // ============================================================================
  // OBJECTIVES
  // ============================================================================

  /**
   * Create objective
   */
  async createObjective(planId: string, data: CreateObjectiveInput) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/objectives`);
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create objective');
    return response.json();
  },

  /**
   * Update objective
   */
  async updateObjective(planId: string, objectiveId: string, data: Partial<CreateObjectiveInput>) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/objectives/${encodeURIComponent(objectiveId)}`);
    const response = await authenticatedFetch(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update objective');
    return response.json();
  },

  /**
   * Delete objective
   */
  async deleteObjective(planId: string, objectiveId: string) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/objectives/${encodeURIComponent(objectiveId)}`);
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete objective');
    return response.json();
  },

  // ============================================================================
  // BUDGET CATEGORIES
  // ============================================================================

  /**
   * Create budget category
   */
  async createBudgetCategory(planId: string, data: CreateBudgetCategoryInput) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/budget-categories`);
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create budget category');
    return response.json();
  },

  /**
   * Update budget category
   */
  async updateBudgetCategory(planId: string, categoryId: string, data: Partial<CreateBudgetCategoryInput>) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/budget-categories/${encodeURIComponent(categoryId)}`);
    const response = await authenticatedFetch(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update budget category');
    return response.json();
  },

  /**
   * Delete budget category
   */
  async deleteBudgetCategory(planId: string, categoryId: string) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/budget-categories/${encodeURIComponent(categoryId)}`);
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete budget category');
    return response.json();
  },

  // ============================================================================
  // RESOURCE ALLOCATIONS
  // ============================================================================

  /**
   * Create resource allocation
   */
  async createResourceAllocation(planId: string, data: CreateResourceAllocationInput) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/resource-allocations`);
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create resource allocation');
    return response.json();
  },

  /**
   * Update resource allocation
   */
  async updateResourceAllocation(planId: string, allocationId: string, data: Partial<CreateResourceAllocationInput>) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/resource-allocations/${encodeURIComponent(allocationId)}`);
    const response = await authenticatedFetch(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update resource allocation');
    return response.json();
  },

  /**
   * Delete resource allocation
   */
  async deleteResourceAllocation(planId: string, allocationId: string) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/resource-allocations/${encodeURIComponent(allocationId)}`);
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete resource allocation');
    return response.json();
  },

  // ============================================================================
  // MILESTONES
  // ============================================================================

  /**
   * Create milestone
   */
  async createMilestone(planId: string, data: CreateMilestoneInput) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/milestones`);
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create milestone');
    return response.json();
  },

  /**
   * Update milestone
   */
  async updateMilestone(planId: string, milestoneId: string, data: Partial<CreateMilestoneInput>) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/milestones/${encodeURIComponent(milestoneId)}`);
    const response = await authenticatedFetch(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update milestone');
    return response.json();
  },

  /**
   * Delete milestone
   */
  async deleteMilestone(planId: string, milestoneId: string) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/milestones/${encodeURIComponent(milestoneId)}`);
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete milestone');
    return response.json();
  },

  // ============================================================================
  // PROJECTS
  // ============================================================================

  /**
   * Link project to plan
   */
  async linkProject(planId: string, projectId: string) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/projects`);
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    });
    if (!response.ok) throw new Error('Failed to link project');
    return response.json();
  },

  /**
   * Unlink project from plan
   */
  async unlinkProject(planId: string, projectId: string) {
    const url = buildUrl(`/plans/${encodeURIComponent(planId)}/projects/${encodeURIComponent(projectId)}`);
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to unlink project');
    return response.json();
  },

  // ============================================================================
  // ACTIVITY
  // ============================================================================

  /**
   * Get activity feed for plan
   */
  async getActivity(planId: string, limit = 20) {
    const url = `${buildUrl(`/plans/${encodeURIComponent(planId)}/activity`)}?limit=${limit}`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch activity');
    return response.json();
  },
};
