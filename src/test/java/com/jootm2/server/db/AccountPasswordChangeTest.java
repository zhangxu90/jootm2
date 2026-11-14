package com.jootm2.server.db;

import com.jootm2.server.db.Account;
import com.jootm2.server.db.AccountDao;
import com.jootm2.server.db.Database;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AccountPasswordChangeTest {

    @TempDir
    Path tempDir;

    @Test
    void onlyCurrentPasswordCanAuthorizePasswordChange() throws Exception {
        try (Database database = new Database(tempDir.resolve("accounts.db").toString())) {
            AccountDao accounts = new AccountDao(database);
            Account created = accounts.register("test-user", "old-password");
            assertNotNull(created);

            assertFalse(accounts.changePassword("test-user", "incorrect", "new-password"));
            assertNotNull(accounts.authenticate("test-user", "old-password"));

            assertTrue(accounts.changePassword("test-user", "old-password", "new-password"));
            assertNull(accounts.authenticate("test-user", "old-password"));
            assertNotNull(accounts.authenticate("test-user", "new-password"));
        }
    }

    @Test
    void rejectsUnknownAccountsAndMissingCredentials() throws Exception {
        try (Database database = new Database(tempDir.resolve("empty.db").toString())) {
            AccountDao accounts = new AccountDao(database);
            assertFalse(accounts.changePassword("missing", "old-password", "new-password"));
            assertFalse(accounts.changePassword(null, "old-password", "new-password"));
            assertFalse(accounts.changePassword("missing", null, "new-password"));
        }
    }
}
