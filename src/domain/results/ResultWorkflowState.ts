/**
 * Results Workflow State Machine
 * 
 * Enforces strict lifecycle for result assessments.
 * Transitions are deterministic and enforced at domain layer.
 */

export enum ResultWorkflowState {
  /**
   * Initial state - Assessment created, no configuration
   */
  DRAFT = 'DRAFT',

  /**
   * Configuration complete - Assessment structure defined (CA/Test/Exam weights)
   */
  CONFIGURED = 'CONFIGURED',

  /**
   * All scores entered for all students
   */
  SCORED = 'SCORED',

  /**
   * Grades calculated for all results
   */
  GRADED = 'GRADED',

  /**
   * Subject and class positions calculated
   */
  POSITIONED = 'POSITIONED',

  /**
   * Validation passed - all checks successful
   */
  VALIDATED = 'VALIDATED',

  /**
   * Results locked - cannot edit scores
   */
  LOCKED = 'LOCKED',

  /**
   * Published - visible to parents/teachers
   */
  PUBLISHED = 'PUBLISHED',
}

/**
 * Valid state transitions
 * Define exactly which states can transition to which
 */
export const WORKFLOW_TRANSITIONS: Record<ResultWorkflowState, ResultWorkflowState[]> = {
  [ResultWorkflowState.DRAFT]: [
    ResultWorkflowState.CONFIGURED, // Admin configures assessment
  ],
  [ResultWorkflowState.CONFIGURED]: [
    ResultWorkflowState.SCORED, // Scores entered
    ResultWorkflowState.DRAFT, // Can revert to draft
  ],
  [ResultWorkflowState.SCORED]: [
    ResultWorkflowState.GRADED, // Calculate grades
    ResultWorkflowState.CONFIGURED, // Revert if needed
  ],
  [ResultWorkflowState.GRADED]: [
    ResultWorkflowState.POSITIONED, // Calculate positions
    ResultWorkflowState.SCORED, // Revert
  ],
  [ResultWorkflowState.POSITIONED]: [
    ResultWorkflowState.VALIDATED, // Validate
    ResultWorkflowState.GRADED, // Revert
  ],
  [ResultWorkflowState.VALIDATED]: [
    ResultWorkflowState.LOCKED, // Lock results
    ResultWorkflowState.POSITIONED, // Revert
  ],
  [ResultWorkflowState.LOCKED]: [
    ResultWorkflowState.PUBLISHED, // Publish
    ResultWorkflowState.VALIDATED, // Unlock
  ],
  [ResultWorkflowState.PUBLISHED]: [
    ResultWorkflowState.LOCKED, // Unpublish
    ResultWorkflowState.VALIDATED, // Unpublish
  ],
};

/**
 * Check if transition is valid
 */
export function isValidTransition(
  from: ResultWorkflowState,
  to: ResultWorkflowState
): boolean {
  return WORKFLOW_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get user-friendly state name
 */
export function getStateName(state: ResultWorkflowState): string {
  const names: Record<ResultWorkflowState, string> = {
    [ResultWorkflowState.DRAFT]: 'Draft - Ready to Configure',
    [ResultWorkflowState.CONFIGURED]: 'Configured - Ready for Scores',
    [ResultWorkflowState.SCORED]: 'Scores Entered - Ready to Grade',
    [ResultWorkflowState.GRADED]: 'Grades Calculated - Ready for Positions',
    [ResultWorkflowState.POSITIONED]: 'Positions Calculated - Ready to Validate',
    [ResultWorkflowState.VALIDATED]: 'Validated - Ready to Lock',
    [ResultWorkflowState.LOCKED]: 'Locked - Ready to Publish',
    [ResultWorkflowState.PUBLISHED]: 'Published - Live',
  };
  return names[state] || state;
}

/**
 * Get next allowed transitions
 */
export function getNextTransitions(state: ResultWorkflowState): ResultWorkflowState[] {
  return WORKFLOW_TRANSITIONS[state] || [];
}
