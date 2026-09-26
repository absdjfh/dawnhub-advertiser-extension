/**
 * Wrapper around {@link MutationObserver} that automatically disconnects and reconnects before/after handling changes
 * @param target - see {@link MutationObserver.observe}
 * @param options - see {@link MutationObserver.observe}
 * @param onChange - callback to run when an observer triggers
 */
export function registerObserver(target: Node, options: MutationObserverInit, onChange: (mutations: MutationRecord[]) => void) {
    const observer = new MutationObserver((mutations, observer) => {
        observer.disconnect()
        try {
            onChange(mutations)
        } finally {
            observer.observe(target, options)
        }
    })
    observer.observe(target, options)
    return observer
}

export function anyNodeMatches(mutations: MutationRecord[], predicate: (Node: Node) => boolean) {
    function matches(nodes: NodeList) {
        return nodes.entries().some(([, node]) => predicate(node))
    }
    return mutations.some(mutation => matches(mutation.addedNodes) || matches(mutation.removedNodes))
}
