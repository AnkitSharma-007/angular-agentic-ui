export interface ComparisonOption {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly details: readonly ComparisonDetail[];
  readonly highlight?: string;
}

export interface ComparisonDetail {
  readonly label: string;
  readonly value: string;
}

export interface LetUserChooseArgs {
  readonly context: string;
  readonly instruction?: string;
  readonly options: readonly ComparisonOption[];
}

export interface LetUserChooseResult {
  readonly selected: ComparisonOption;
}
