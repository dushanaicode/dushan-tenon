// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pagination } from "@/kit";

export function PaginationExample() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  return (
    <div className="space-y-2">
      <p role="status">
        {t("showcase.navigation.pageRecord", { number: page })}
      </p>
      <Pagination page={page} pageSize={1} total={3} onPageChange={setPage} />
    </div>
  );
}
