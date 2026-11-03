import { useEffect } from "react";
import { useLocation } from "react-router";
import { recordRecentPage } from "./showcase/recent-pages";

export function useRecordRecentPage() {
  const { pathname } = useLocation();
  useEffect(() => recordRecentPage(pathname), [pathname]);
}
