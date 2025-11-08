import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Mail, Briefcase } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useUsers } from "@/hooks/useUsers";

export default function Users() {
  const { data: users = [], isLoading: isLoadingUsers } = useUsers();
  const [searchQuery, setSearchQuery] = useState("");

  // Helper function to get user avatar initials
  const getUserInitials = (user: { firstName: string; lastName: string; email: string }) => {
    const firstName = user.firstName || "";
    const lastName = user.lastName || "";
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    if (firstName) {
      return firstName.charAt(0).toUpperCase();
    }
    if (user.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return "U";
  };

  // Filter users based on search query
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) {
      return users;
    }
    const query = searchQuery.toLowerCase();
    return users.filter((user) => {
      const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
      const email = user.email?.toLowerCase() || "";
      const jobTitle = user.jobTitle?.toLowerCase() || "";
      return (
        fullName.includes(query) ||
        email.includes(query) ||
        jobTitle.includes(query)
      );
    });
  }, [users, searchQuery]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">
            View all users in your organization
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users by name, email, or job title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'}
        </div>
      </div>

      {isLoadingUsers ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading users...</p>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchQuery ? 'No users found matching your search.' : 'No users found.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredUsers.map((user) => (
            <Card 
              key={user.email}
              className="bg-gradient-card border-border shadow-card transition-all hover:shadow-lg hover:scale-105"
            >
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <Avatar className="h-12 w-12 bg-primary">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {getUserInitials(user)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base truncate">
                    {user.firstName} {user.lastName}
                  </CardTitle>
                  <CardDescription className="text-xs truncate flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {user.email}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {user.jobTitle && (
                    <div className="flex items-center gap-2 text-sm">
                      <Briefcase className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">{user.jobTitle}</span>
                    </div>
                  )}
                  {user.responsibilities && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {user.responsibilities}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

