import {
  getAgentStats,
  getTokenUsageDetails
} from '../store/chat';
import type { MonitoringTokenQuery } from '../../shared/contracts';

export function getMonitoringAgentStats() {
  return getAgentStats();
}

export function getMonitoringTokenUsageDetails(query: MonitoringTokenQuery) {
  return getTokenUsageDetails(query);
}
