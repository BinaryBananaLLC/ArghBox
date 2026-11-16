/** The package version, which is also the version of the arghbox/ folder. Use it for the ?v= of the script tag. */
export declare const version: string;
/** Absolute path of the arghbox/ folder to upload to the web root. */
export declare const serverDir: string;
/** Absolute path of the triage skill folder (goes to .claude/skills/arghbox-triage/). */
export declare const skillDir: string;

export interface InstallOptions {
  /** The site repository. Default: the current folder. */
  target?: string;
  /** The folder served as the web root, relative to target (for example 'public', 'public_html' or '.'). */
  publicDir?: string;
  /** Also copy the triage skill to <target>/.claude/skills/arghbox-triage/. */
  skill?: boolean;
  /** Copy only the triage skill. */
  skillOnly?: boolean;
  /** Plan only, change nothing. */
  dryRun?: boolean;
}

export interface InstallAction {
  kind: 'create' | 'update' | 'same' | 'keep' | 'skip';
  /** The file, relative to target. */
  file: string;
  /** Where the previous copy of an updated skill file was saved. */
  backup?: string;
}

export interface InstallResult {
  actions: InstallAction[];
  /** The lines to add to the site's .gitignore. */
  gitignore: string[];
  warnings: string[];
  dryRun: boolean;
  version: string | null;
}

/** Copies the arghbox/ folder (and optionally the triage skill) into a site. Never touches config.php or data/. */
export declare function install(options?: InstallOptions): InstallResult;
