// Quill, on its own so the company card can load it on demand. The editor
// only draws for one opportunity's notes on the Opps tab, but imported at
// the top of ProspectModal it (and lodash, parchment, fast-diff and the
// snow theme it drags in) rode in the chunk that every company-card open
// has to download first. Keeping the stylesheet here means it arrives
// with the editor instead of with the card.
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

export default ReactQuill;
