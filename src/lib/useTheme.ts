import { useConfigStore } from '../store/config';
import { getTheme, type AppTheme } from './themes';

export function useAppTheme(): AppTheme {
  const themeId = useConfigStore((state) => state.config?.prefs.theme);
  return getTheme(themeId);
}
