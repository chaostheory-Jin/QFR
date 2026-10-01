import unittest

from export_quickbooks_frontend_data import review_fields


class ReviewExportTests(unittest.TestCase):
    def line(self, **changes):
        return dict(LineNumber='12', InferredRole='expense', ReviewRequired='False',
                    ReviewReason='', Confidence='0.99', MappedCategory='Expenses > Rent',
                    AutoAcceptedCategory='Expenses > Rent', **changes)

    def test_preserves_non_confidence_review_flags(self):
        line = self.line()
        line.update(ReviewRequired='True', ReviewReason='Item changed after transaction')
        result = review_fields(line, 0.7)
        self.assertTrue(result['ReviewRequired'])
        self.assertEqual(result['ReviewReason'], line['ReviewReason'])
        self.assertEqual(result['AutoAcceptedCategory'], '')
        self.assertEqual(result['LineID'], 'quickbooks-pl-12')

    def test_threshold_equality_enters_review(self):
        line = self.line()
        line['Confidence'] = '0.7'
        self.assertTrue(review_fields(line, 0.7)['ReviewRequired'])

    def test_legacy_metadata_is_not_assumed_auto_accepted(self):
        line = self.line()
        del line['ReviewRequired']
        result = review_fields(line, 0.7)
        self.assertTrue(result['ReviewRequired'])
        self.assertIn('Legacy', result['ReviewReason'])


if __name__ == '__main__':
    unittest.main()
