/* global expect */

function shouldHaveBeenCalledInOrder(mocks) {
	mocks.reduce((prevInvocation, mockFn) => {
		expect(mockFn.mock.invocationCallOrder[0]).toBeGreaterThan(prevInvocation);
		return mockFn.mock.invocationCallOrder[0];
	}, -1);
}

module.exports = {
	shouldHaveBeenCalledInOrder,
};
