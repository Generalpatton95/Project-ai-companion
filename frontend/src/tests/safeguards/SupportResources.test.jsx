import { render, screen, within } from '@testing-library/react';
import SupportResources from '../../components/safeguards/SupportResources.jsx';

describe('SupportResources', () => {
  it('R2.4: links an https:// contact and shows the others as text', () => {
    render(
      <SupportResources
        message="These people are there to listen."
        resources={[
          { name: '988 Suicide & Crisis Lifeline (US)', contact: 'Call or text 988' },
          { name: 'International Association for Suicide Prevention', contact: 'https://www.iasp.info/resources/Crisis_Centres/' }
        ]}
      />
    );

    const support = screen.getByLabelText('Support resources');
    expect(support).toHaveTextContent('These people are there to listen.');
    const items = within(support).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('988 Suicide & Crisis Lifeline (US): Call or text 988');
    expect(within(items[0]).queryByRole('link')).not.toBeInTheDocument();
    const link = within(items[1]).getByRole('link');
    expect(link).toHaveAttribute('href', 'https://www.iasp.info/resources/Crisis_Centres/');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it.each([
    'http://example.com/help',
    'javascript:alert(1)',
    'httpsx://example.com',
    'data:text/html,hi'
  ])('R2.4: a contact that is not https:// (%s) is shown as text, never as a link', (contact) => {
    render(<SupportResources resources={[{ name: 'Somewhere', contact }]} />);

    const support = screen.getByLabelText('Support resources');
    expect(within(support).queryByRole('link')).not.toBeInTheDocument();
    expect(support).toHaveTextContent(`Somewhere: ${contact}`);
  });
});
