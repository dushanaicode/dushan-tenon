import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";
import { findActiveItem, type NavTree } from "../nav-tree";

export type NavExpansion = {
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
};

const Context = createContext<NavExpansion | null>(null);

// Shell lives beneath WorkbenchProvider key={userId}; changing the subject
// remounts this session state, while changing the layout leaves it intact.
export function NavExpansionProvider({
  tree,
  children,
}: {
  tree: NavTree;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const activeParent = findActiveItem(tree, pathname)?.parent?.id;
  const previous = useRef(activeParent);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(activeParent ? [activeParent] : []),
  );
  useEffect(() => {
    const entered = activeParent !== previous.current;
    previous.current = activeParent;
    const available = new Set(
      tree.groups.flatMap((group) =>
        group.items
          .filter((item) => item.kind === "parent")
          .map((item) => item.id),
      ),
    );
    setExpanded((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      if (entered && activeParent) next.add(activeParent);
      return next.size === current.size &&
        [...next].every((id) => current.has(id))
        ? current
        : next;
    });
  }, [tree, activeParent]);
  return (
    <Context
      value={{
        expanded,
        toggle: (id) =>
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
      }}
    >
      {children}
    </Context>
  );
}

export function useNavExpansion(): NavExpansion {
  const value = useContext(Context);
  if (!value) throw new Error("NavExpansionProvider is required");
  return value;
}
