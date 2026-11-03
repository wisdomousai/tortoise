/** The operating properties, each with the mechanism, its guide and the tests that prove it. */
import { link, table, testList, type View } from './dom';

export const properties: View = (element, data, links) => {
  element.replaceChildren(
    table(
      'ov-properties',
      ['Property', 'Mechanism', 'Tests'],
      data.properties.map((entry) => [
        entry.property,
        [entry.mechanism, ' ', link(links.doc(entry.doc), data.docs[entry.doc] ?? entry.doc)],
        testList(entry.tests, links),
      ]),
    ),
  );
};
