import type { Accessor } from "solid-js";

export type IdeSelectOption = Readonly<{
  value: string;
  label: string;
  textValue: string;
  executable: string;
  icon: string | null;
  iconData: string | null;
}>;

export type MoveLocationOption = Readonly<{
  value: string;
  label: string;
  textValue: string;
  disabled?: boolean;
}>;

export type ProjectDetailViewProps = Readonly<{
  projectId: string;
  onBack: () => void;
  detailTab: Accessor<string>;
  onDetailTabChange: (tab: string) => void;
  subDetail: Accessor<string | null>;
  onSubDetailChange: (sub: string | null) => void;
}>;
