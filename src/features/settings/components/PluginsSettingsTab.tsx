import { type Component } from "solid-js";
import { PluginDashboard } from "./PluginDashboard";

interface PluginsSettingsTabProps {
  t: (key: string, params?: Record<string, unknown>) => string;
}

export const PluginsSettingsTab: Component<PluginsSettingsTabProps> = (props) => {
  return <PluginDashboard t={props.t} />;
};
