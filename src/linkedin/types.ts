export type Sections = Record<string, string>;
export type References = Record<string, string>;

export type ToolResult = {
  url: string;
  sections: Sections;
  references?: References;
  profile_urn?: string;
  section_errors?: Record<string, string>;
  // write tools
  status?: string;
  sent?: boolean;
  note_sent?: boolean;
  message?: string;
  recipient_selected?: boolean;
  // search/job tools
  job_ids?: string[];
  // tier 2 helpers
  unknown_sections?: string[];
};

export type AuthRequiredResult = {
  status: 'auth_required';
  message: string;
};

export type ErrorResult = {
  status: 'error';
  error: string;
  detail?: string;
};

export type CommandResult = ToolResult | AuthRequiredResult | ErrorResult;

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_AUTH_REQUIRED = 2;
